import { z } from "zod";
import { readJson, RequestBodyError } from "@/lib/request-body";
import { presentBill } from "@/services/bill-presentation";
import { db } from "@/database/client";
import { advanceBill } from "@/workflows/bill-workflow";
import {
  correctBill,
  decideApproval,
  retryPayment,
  rereadDocument,
} from "@/services/human-actions";
import { currentUser, requireSameOrigin } from "@/services/session";
import { acceptProperty } from "@/services/property-onboarding";
import {
  confirmPaymentDestination,
  resumePaymentNavigation,
  reconcilePaymentNavigation,
} from "@/services/payment-navigation";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const bill = await db.bill.findUnique({
    where: { id },
    include: {
      vendor: true,
      property: true,
      proposedProperty: true,
      account: true,
      extraction: true,
      navigation: true,
      payment: { include: { attempts: { orderBy: { number: "asc" } } } },
      approvals: true,
      reviews: true,
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  return bill
    ? Response.json(presentBill(bill), {
        headers: { "Cache-Control": "no-store" },
      })
    : Response.json({ error: "Bill not found" }, { status: 404 });
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireSameOrigin(request);
    const { id } = await context.params;
    const body = z
      .object({
        action: z.enum([
          "advance",
          "correct",
          "approve",
          "reject",
          "retry",
          "reread",
          "destination",
          "resume-browser",
          "reconcile-browser",
          "accept-property",
        ]),
        data: z.unknown().optional(),
        note: z.string().max(2000).optional(),
      })
      .parse(await readJson(request));
    const user = await currentUser();
    if (body.action === "advance") await advanceBill(id);
    if (body.action === "correct") await correctBill(id, body.data, user);
    if (body.action === "approve" || body.action === "reject")
      await decideApproval(
        id,
        body.action === "approve",
        body.note ?? "",
        user,
      );
    if (body.action === "retry") await retryPayment(id, user);
    if (body.action === "reread") await rereadDocument(id, user);
    if (body.action === "accept-property")
      await acceptProperty(
        id,
        z.object({ propertyId: z.string().min(1) }).parse(body.data).propertyId,
        user,
      );
    if (body.action === "destination")
      await confirmPaymentDestination(
        id,
        z.object({ url: z.string().url().max(2000) }).parse(body.data).url,
        user,
      );
    if (body.action === "resume-browser")
      await resumePaymentNavigation(id, user);
    if (body.action === "reconcile-browser")
      await reconcilePaymentNavigation(id);
    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The action could not be completed";
    return Response.json(
      {
        error:
          message.includes("prisma") || message.includes("Unique constraint")
            ? "Another request updated this invoice. Refresh and try again."
            : message,
      },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
}
