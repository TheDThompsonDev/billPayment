export type Policy = {
  id: string;
  name: string;
  description: string;
  minimumCents: number;
  maximumCents: number | null;
  category: string | null;
  role: string | null;
  priority: number;
};
export const policyDefinitions: Policy[] = [
  {
    id: "tax",
    name: "Property taxes",
    description: "Property taxes always require Director approval.",
    minimumCents: 1,
    maximumCents: null,
    category: "PROPERTY_TAX",
    role: "DIRECTOR",
    priority: 100,
  },
  {
    id: "director",
    name: "High-value expenses",
    description: "Bills above $20,000 require Director approval.",
    minimumCents: 2000001,
    maximumCents: null,
    category: null,
    role: "DIRECTOR",
    priority: 90,
  },
  {
    id: "regional",
    name: "Regional approval",
    description:
      "Expenses from $5,000 to $20,000 require Regional Manager approval.",
    minimumCents: 500000,
    maximumCents: 2000000,
    category: null,
    role: "REGIONAL_MANAGER",
    priority: 80,
  },
  {
    id: "utility-auto",
    name: "Routine utilities",
    description: "Utilities below $2,000 are automatically approved.",
    minimumCents: 1,
    maximumCents: 199999,
    category: "UTILITY",
    role: null,
    priority: 70,
  },
  {
    id: "manager",
    name: "Property approval",
    description:
      "Utilities from $2,000 to below $5,000 and other lower-value expenses require Property Manager approval.",
    minimumCents: 1,
    maximumCents: 499999,
    category: null,
    role: "PROPERTY_MANAGER",
    priority: 10,
  },
];
export function determineApproval(
  bill: { amountCents: number; category: string },
  policies: Policy[],
) {
  if (!Number.isSafeInteger(bill.amountCents) || bill.amountCents <= 0)
    throw new Error("Invalid amount for approval");
  const policy = [...policies]
    .sort((a, b) => b.priority - a.priority)
    .find(
      (p) =>
        (!p.category || p.category === bill.category) &&
        bill.amountCents >= p.minimumCents &&
        (p.maximumCents === null || bill.amountCents <= p.maximumCents),
    );
  if (!policy) throw new Error("No approval policy applies; workflow stopped");
  return {
    type: policy.role
      ? ("REQUIRES_APPROVAL" as const)
      : ("AUTO_APPROVED" as const),
    role: policy.role,
    policyId: policy.id,
    reason: policy.description,
  };
}
export function canApprove(role: string, required: string) {
  const levels: Record<string, number> = {
    ANALYST: 0,
    PROPERTY_MANAGER: 1,
    REGIONAL_MANAGER: 2,
    DIRECTOR: 3,
  };
  return (
    required in levels &&
    role in levels &&
    levels[role] >= levels[required] &&
    levels[role] > 0
  );
}
