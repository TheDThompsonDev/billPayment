import type { Finding } from "../bills/types";
export function evaluateRisk(
  input: {
    amountCents: number;
    historicalAmounts: number[];
    dueDate: Date;
    active: boolean;
    knownRelationship: boolean;
    acknowledged?: boolean;
  },
  now = new Date(),
): Finding[] {
  const findings: Finding[] = [];
  if (input.amountCents <= 0)
    findings.push({
      code: "INVALID_AMOUNT",
      message: "Amount must be greater than zero.",
      severity: "review",
    });
  const average = input.historicalAmounts.length
    ? input.historicalAmounts.reduce((a, b) => a + b, 0) /
      input.historicalAmounts.length
    : 0;
  if (average && input.amountCents > average * 3)
    findings.push({
      code: "AMOUNT_OUTLIER",
      message: `Amount is ${(input.amountCents / average).toFixed(1)}× the historical average of $${(average / 100).toFixed(2)}. Confirm the amount and explain the variance.`,
      severity: input.acknowledged ? "info" : "review",
    });
  if (input.dueDate.toISOString().slice(0, 10) < now.toISOString().slice(0, 10))
    findings.push({
      code: "OVERDUE",
      message:
        "Due date has passed. Confirm a current due date with the vendor.",
      severity: "review",
    });
  if (!input.active)
    findings.push({
      code: "INACTIVE_ACCOUNT",
      message: "Vendor account is inactive. Select an active account.",
      severity: "review",
    });
  if (!input.knownRelationship)
    findings.push({
      code: "UNKNOWN_RELATIONSHIP",
      message: "No confirmed vendor/property account relationship.",
      severity: "review",
    });
  return findings;
}
