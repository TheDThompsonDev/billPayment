import { z } from "zod";
import { readJson, RequestBodyError } from "@/lib/request-body";
import { db } from "@/database/client";
import { destinationURL } from "@/domain/payments/payment-destination";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    const body = z
      .object({
        billId: z.string(),
        account: z.string(),
        invoice: z.string(),
        amountCents: z.number().int().positive().optional(),
      })
      .parse(await readJson(request));
    const result = await db.$transaction(async (tx) => {
      const bill = await tx.bill.findUniqueOrThrow({
        where: { id: body.billId },
        include: {
          account: true,
          vendor: true,
          navigation: true,
          payment: true,
        },
      });
      const nav = bill.navigation;
      if (
        !nav?.runToken ||
        request.headers.get("x-dsd-run-token") !== nav.runToken ||
        nav.status !== "RUNNING" ||
        !nav.destination ||
        !destinationURL(nav.destination).isDemo
      )
        throw new Error("An active local browser run is required");
      if (
        bill.account?.number !== body.account ||
        bill.invoiceNumber !== body.invoice
      )
        throw new Error("Account or invoice not found");
      if (action === "lookup")
        return {
          account: bill.account.number,
          invoice: bill.invoiceNumber,
          amountCents: bill.amountCents,
        };
      if (
        action !== "pay" ||
        bill.status !== "PAYMENT_PENDING" ||
        !bill.payment ||
        body.amountCents !== bill.amountCents
      )
        throw new Error(
          "Payment must be reserved with the exact invoice amount",
        );
      const receipt = await tx.portalReceipt.upsert({
        where: { billId: bill.id },
        update: {},
        create: {
          billId: bill.id,
          vendorName: bill.vendor!.name,
          accountNumber: bill.account.number,
          invoiceNumber: bill.invoiceNumber!,
          amountCents: bill.amountCents!,
        },
      });
      return { receipt: `DEMO-${receipt.id}` };
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Portal request failed",
      },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
}
