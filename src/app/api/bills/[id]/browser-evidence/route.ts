import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/database/client";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (
    !/^[a-z0-9-]+$/i.test(id) ||
    !(await db.paymentNavigation.findUnique({ where: { billId: id } }))
  )
    return new Response("Not found", { status: 404 });
  try {
    return new Response(
      await readFile(path.resolve("storage/payment-evidence", `${id}.png`)),
      { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } },
    );
  } catch {
    return new Response("Browser evidence is not available yet", {
      status: 404,
    });
  }
}
