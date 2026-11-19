import { readFile } from "node:fs/promises";
import { db } from "@/database/client";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const bill = await db.bill.findUnique({ where: { id } });
  if (!bill?.documentPath)
    return new Response("Document not found", { status: 404 });
  try {
    const bytes = await readFile(bill.documentPath);
    return new Response(bytes, {
      headers: {
        "Content-Type": bill.documentType ?? "application/octet-stream",
        "Content-Disposition": "inline",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return new Response("Document unavailable", { status: 404 });
  }
}
