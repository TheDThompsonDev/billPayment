import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extractionSchema, type BillExtraction } from "../domain/bills/types";
import { extractPDFText } from "./pdf-text-understanding";
import { readDocumentWithAI, DocumentReadError } from "./document-reader";
import { sampleExtraction } from "./samples";
export type BillDocument = {
  sampleKey?: string | null;
  documentPath?: string | null;
  documentName: string;
  documentType?: string | null;
};
export interface BillUnderstandingService {
  extract(document: BillDocument): Promise<{
    fields: BillExtraction;
    provider: string;
    paymentUrls?: string[];
    propertyName?: string;
    evidence?: unknown;
  }>;
}
export class DemoBillUnderstanding implements BillUnderstandingService {
  async extract(document: BillDocument) {
    if (document.sampleKey)
      return {
        fields: sampleExtraction(document.sampleKey),
        provider: "Deterministic demo fixture",
      };
    // Recognition is by the file bytes, never by a user-controlled filename.
    if (document.documentPath) {
      const bytes = await readFile(document.documentPath);
      for (const key of ["happy", "approval", "ambiguous", "failure"]) {
        try {
          const fixture = await readFile(`public/samples/${key}.pdf`);
          if (
            createHash("sha256").update(bytes).digest("hex") ===
            createHash("sha256").update(fixture).digest("hex")
          ) {
            const fieldsFile = await readFile(
              `public/samples/${key}.json`,
              "utf8",
            );
            return {
              fields: extractionSchema.parse(JSON.parse(fieldsFile)),
              provider: "Demo fixture recognized by SHA-256",
            };
          }
        } catch {
          /* Unknown file follows the safe review path. */
        }
      }
    }
    return {
      fields: extractionSchema.parse({
        vendorName: null,
        accountNumber: null,
        invoiceNumber: null,
        amount: null,
        dueDate: null,
        serviceAddress: null,
      }),
      provider: "Manual review required — no AI key",
    };
  }
}
export class StructuredAIBillUnderstanding implements BillUnderstandingService {
  async extract(document: BillDocument) {
    return readDocumentWithAI(document);
  }
}
export async function understand(document: BillDocument): Promise<{
  fields: BillExtraction;
  provider: string;
  paymentUrls?: string[];
  propertyName?: string;
  evidence?: unknown;
}> {
  const demo = await new DemoBillUnderstanding().extract(document);
  if (demo.fields.vendorName) return demo;
  if (process.env.BILL_EXTRACTION_MODE !== "offline")
    return new StructuredAIBillUnderstanding().extract(document);
  if (document.documentType === "application/pdf" && document.documentPath) {
    const result = await extractPDFText(await readFile(document.documentPath));
    return {
      ...result,
      provider: `Limited offline reader · ${result.provider}`,
    };
  }
  throw new DocumentReadError(
    "OFFLINE_READER_UNSUPPORTED",
    "The limited offline reader cannot interpret images. Connect the document AI reader or enter the details manually.",
  );
}
