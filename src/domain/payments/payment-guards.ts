import { methods } from "../bills/types";
export function assertPaymentSafe(input: {
  status: string;
  completed: boolean;
  duplicate: boolean;
  method: string | null;
  amountCents: number | null;
  accountActive: boolean;
  requiredFields: boolean;
  approvalSatisfied: boolean;
  openReview: boolean;
}) {
  if (input.status !== "APPROVED")
    throw new Error("Payment requires an APPROVED bill");
  if (input.completed) throw new Error("A completed payment already exists");
  if (input.duplicate) throw new Error("Duplicate invoices cannot be paid");
  if (!methods.includes(input.method as (typeof methods)[number]))
    throw new Error("Invalid payment method");
  if (
    !input.amountCents ||
    input.amountCents <= 0 ||
    !Number.isSafeInteger(input.amountCents)
  )
    throw new Error("Invalid payment amount");
  if (!input.accountActive || !input.requiredFields)
    throw new Error("Required account or invoice information is missing");
  if (!input.approvalSatisfied)
    throw new Error("Approval authority has not been satisfied");
  if (input.openReview) throw new Error("Unresolved review prevents payment");
}
