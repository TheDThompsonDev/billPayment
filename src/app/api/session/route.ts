import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/database/client";
import { requireSameOrigin } from "@/services/session";
import { readJson, RequestBodyError } from "@/lib/request-body";
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { userId } = z
      .object({
        userId: z.enum(["analyst", "manager", "regional", "director"]),
      })
      .parse(await readJson(request));
    const token = randomBytes(32).toString("hex");
    const jar = await cookies();
    const old = jar.get("dsd-session")?.value;
    await db.$transaction(async (tx) => {
      await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lte: new Date() } },
            ...(old ? [{ id: old }] : []),
          ],
        },
      });
      await tx.session.create({
        data: { id: token, userId, expiresAt: new Date(Date.now() + 86400000) },
      });
    });
    jar.set("dsd-session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 86400,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Cannot switch persona",
      },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
}
