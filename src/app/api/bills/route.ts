import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/database/client";
import { sampleExtraction } from "@/ai/samples";
import { confirmedSchema, confirmedExtraction } from "@/domain/bills/types";
import { audit } from "@/services/audit";
import { currentUser, requireSameOrigin } from "@/services/session";
import { advanceBill } from "@/workflows/bill-workflow";
import { demoOrigin } from "@/domain/payments/payment-destination";
import { readJson, readUpload, RequestBodyError } from "@/lib/request-body";
export async function POST(request: Request) {
  let uploadedPath: string | undefined;
  let persisted = false;
  try {
    requireSameOrigin(request);
    const user = await currentUser();
    let data: {
      source: string;
      documentName: string;
      sampleKey?: string;
      documentPath?: string;
      documentType?: string;
      documentHash?: string;
    };
    let fields: string | undefined;
    let paymentUrls: string[] = [];
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await readUpload(request);
      const file = form.get("file");
      if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
        throw new Error("Choose a PDF or image up to 10 MB");
      const bytes = Buffer.from(await file.arrayBuffer());
      const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
      const png = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if (!pdf && !png && !jpg)
        throw new Error("Only PDF, PNG and JPEG documents are supported");
      const directory = path.join(process.cwd(), "storage");
      await mkdir(directory, { recursive: true });
      const filePath = path.join(directory, randomUUID());
      await writeFile(filePath, bytes);
      uploadedPath = filePath;
      data = {
        source: "UPLOAD",
        documentName: path.basename(file.name).slice(0, 150),
        documentPath: filePath,
        documentType: pdf
          ? "application/pdf"
          : png
            ? "image/png"
            : "image/jpeg",
        documentHash: createHash("sha256").update(bytes).digest("hex"),
      };
    } else {
      const body = z
        .object({
          sample: z.unknown().optional(),
          fields: z.unknown().optional(),
          paymentUrl: z.unknown().optional(),
        })
        .parse(await readJson(request));
      if (body.sample) {
        const key = z
          .enum([
            "happy",
            "duplicate",
            "approval",
            "ambiguous",
            "failure",
            "portal",
          ])
          .parse(body.sample);
        if (
          key === "duplicate" &&
          !(await db.bill.findFirst({
            where: { dedupeKey: "water:water-main:DW102826823491" },
          }))
        ) {
          const baselineFields = JSON.stringify(sampleExtraction("happy"));
          const baseline = await db.bill.create({
            data: {
              source: "SAMPLE",
              sampleKey: "happy",
              documentName: "Original duplicate-demo invoice",
              extraction: {
                create: {
                  fields: baselineFields,
                  originalFields: baselineFields,
                  provider: "Demo fixture",
                },
              },
              events: {
                create: {
                  type: "BILL_UPLOADED",
                  title: "Original invoice prepared for duplicate scenario",
                  detail:
                    "The original is processed through the same deterministic workflow before the duplicate is submitted.",
                  actor: "Demo scenario",
                },
              },
            },
          });
          for (let stage = 0; stage < 5; stage++)
            await advanceBill(baseline.id);
        }
        // Other scenarios get a fresh invoice ID each run; happy/duplicate deliberately share an ID.
        const extraction = sampleExtraction(
          key,
          ["happy", "duplicate"].includes(key)
            ? ""
            : `-${Date.now().toString(36).toUpperCase()}`,
        );
        fields = JSON.stringify(extraction);
        if (key === "portal")
          paymentUrls = [`${demoOrigin()}/payment-demo/classic`];
        data = {
          source: "SAMPLE",
          documentName: `${key}-demo-invoice.pdf`,
          sampleKey: key,
        };
      } else {
        const values = confirmedSchema.parse(body.fields);
        if (body.paymentUrl)
          paymentUrls = [z.string().url().max(2000).parse(body.paymentUrl)];
        fields = JSON.stringify(confirmedExtraction(values));
        data = {
          source: "MANUAL",
          documentName: `Manual invoice ${values.invoiceNumber}`,
        };
      }
    }
    const bill = await db.$transaction(async (tx) => {
      const bill = await tx.bill.create({ data });
      if (fields)
        await tx.billExtraction.create({
          data: {
            billId: bill.id,
            fields,
            originalFields: fields,
            paymentUrls: JSON.stringify(paymentUrls),
            provider:
              data.source === "MANUAL"
                ? "Human-entered evidence"
                : "Demo fixture",
          },
        });
      await audit(
        tx,
        bill.id,
        "BILL_UPLOADED",
        data.source === "MANUAL" ? "Bill entered manually" : "Bill received",
        `${data.documentName} received. ${data.source === "SAMPLE" ? "Sample fixture; no external AI request." : ""}`,
        user.name,
      );
      return bill;
    });
    persisted = true;
    return Response.json({ id: bill.id }, { status: 201 });
  } catch (error) {
    if (uploadedPath && !persisted) {
      await unlink(uploadedPath).catch((cleanupError: unknown) => {
        console.error("Failed to remove an unpersisted upload", cleanupError);
      });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: error instanceof RequestBodyError ? error.status : 400 },
    );
  }
}
