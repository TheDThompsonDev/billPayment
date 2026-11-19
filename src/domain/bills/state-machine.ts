import { BillStatus } from "./types";
const transitions: Record<BillStatus, readonly BillStatus[]> = {
  RECEIVED: ["PROCESSING"],
  PROCESSING: ["NEEDS_REVIEW", "AWAITING_APPROVAL", "APPROVED", "REJECTED"],
  NEEDS_REVIEW: ["PROCESSING", "REJECTED"],
  AWAITING_APPROVAL: ["APPROVED", "REJECTED"],
  APPROVED: ["PAYMENT_PENDING", "NEEDS_REVIEW"],
  PAYMENT_PENDING: ["PAID", "FAILED"],
  FAILED: ["APPROVED"],
  PAID: [],
  REJECTED: [],
};
export function assertTransition(from: string, to: BillStatus) {
  if (!transitions[from as BillStatus]?.includes(to))
    throw new Error(`Invalid transition: ${from} → ${to}`);
}
