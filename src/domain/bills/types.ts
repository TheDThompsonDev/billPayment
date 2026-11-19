import { z } from "zod";
export const statuses = [
  "RECEIVED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PAYMENT_PENDING",
  "PAID",
  "FAILED",
  "REJECTED",
] as const;
export type BillStatus = (typeof statuses)[number];
export const methods = ["ACH", "CREDIT_CARD", "CHECK", "PORTAL"] as const;
export type PaymentMethod = (typeof methods)[number];
const field = <T extends z.ZodType>(value: T) =>
  z.object({ value, confidence: z.number().min(0).max(1) });
export const extractionSchema = z.object({
  vendorName: field(z.string()).nullable(),
  accountNumber: field(z.string()).nullable(),
  invoiceNumber: field(z.string()).nullable(),
  amount: field(z.number()).nullable(),
  dueDate: field(z.string()).nullable(),
  serviceAddress: field(z.string()).nullable(),
});
export type BillExtraction = z.infer<typeof extractionSchema>;
export const confirmedSchema = z.object({
  vendorName: z.string().trim().min(1).max(200),
  accountNumber: z.string().trim().min(1).max(100),
  invoiceNumber: z.string().trim().min(1).max(100),
  amount: z
    .number()
    .positive()
    .max(10000000)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.00001,
      "Use at most two decimal places",
    ),
  dueDate: z.iso.date(),
  serviceAddress: z.string().trim().min(1),
});
export type ConfirmedFields = z.infer<typeof confirmedSchema>;
export function fieldValues(extraction: BillExtraction) {
  return Object.fromEntries(
    Object.entries(extraction).map(([key, field]) => [
      key,
      field?.value ?? null,
    ]),
  );
}
export function confirmedExtraction(values: ConfirmedFields): BillExtraction {
  return extractionSchema.parse(
    Object.fromEntries(
      Object.entries(values).map(([key, value]) => [
        key,
        { value, confidence: 1 },
      ]),
    ),
  );
}
export type Finding = {
  code: string;
  message: string;
  severity: "review" | "info";
};
