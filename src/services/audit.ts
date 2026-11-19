import type { Prisma } from "@prisma/client";
import { assertTransition } from "../domain/bills/state-machine";
import type { BillStatus } from "../domain/bills/types";
export type Tx = Prisma.TransactionClient;
export async function audit(
  tx: Tx,
  billId: string,
  type: string,
  title: string,
  detail: string,
  actor = "Workflow engine",
  metadata: unknown = {},
) {
  return tx.auditEvent.create({
    data: {
      billId,
      type,
      title,
      detail,
      actor,
      metadata: JSON.stringify(metadata),
    },
  });
}
export async function transition(
  tx: Tx,
  billId: string,
  from: string,
  to: BillStatus,
  detail: string,
  actor = "Workflow engine",
) {
  assertTransition(from, to);
  const changed = await tx.bill.updateMany({
    where: { id: billId, status: from },
    data: { status: to },
  });
  if (changed.count !== 1)
    throw new Error("Bill changed in another request. Refresh and try again.");
  await audit(
    tx,
    billId,
    "STATE_CHANGED",
    `${from.replaceAll("_", " ")} → ${to.replaceAll("_", " ")}`,
    detail,
    actor,
    { from, to },
  );
}
