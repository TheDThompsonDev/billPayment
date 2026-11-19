import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readDocumentWithAI,
  DocumentReadError,
  type DocumentReport,
} from "../src/ai/document-reader";
import { understand } from "../src/ai/bill-understanding";

const document = {
  documentPath: "tests/fixtures/brightwater-bill.pdf",
  documentName: "unfamiliar-layout.pdf",
  documentType: "application/pdf",
};
function report(): DocumentReport {
  const field = <T extends string | number>(value: T) => ({
    value,
    confidence: 0.98,
    source: { page: 2, quote: String(value) },
  });
  return {
    documentKind: "INVOICE",
    fields: {
      vendorName: field("Unseen Provider"),
      accountNumber: field("000123"),
      invoiceNumber: field("INV-12"),
      amount: field(83.2),
      dueDate: field("2026-11-15"),
      serviceAddress: field("12 Pine St, Austin, TX 78701"),
    },
    propertyName: "Pine Apartments",
    paymentUrls: ["https://example.com/pay"],
    issues: [],
  };
}
function response(value: unknown) {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: JSON.stringify(value) }] },
      ],
    }),
  );
}
const failsWith = (code: string) => (error: unknown) =>
  error instanceof DocumentReadError && error.code === code;

test("original PDF pages use a strict evidence contract; identifiers and page sources are retained", async () => {
  let request!: {
    store: boolean;
    text: { format: { strict: boolean } };
    input: { content: { type: string; file_data: string }[] }[];
  };
  const result = await readDocumentWithAI(document, {
    apiKey: "test-only",
    fetcher: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return response(report());
    },
  });
  assert.equal(request.store, false);
  assert.equal(request.text.format.strict, true);
  assert.equal(request.input[0].content[0].type, "input_file");
  assert.match(
    request.input[0].content[0].file_data,
    /^data:application\/pdf;base64,JVBER/,
  );
  assert.equal(result.fields.accountNumber?.value, "000123");
  assert.equal(result.evidence.report.fields.amount?.source.page, 2);
  assert.equal(result.fields.amount?.value, 83.2);
  assert.ok(!("source" in result.fields.amount!));
});

test("image inputs use vision and reported ambiguity overrides a populated field", async () => {
  const value = report();
  value.issues.push({ field: "amount", reason: "Two competing totals" });
  const result = await readDocumentWithAI(
    { ...document, documentType: "image/png" },
    {
      apiKey: "test-only",
      fetcher: async (_url, init) => {
        assert.equal(
          JSON.parse(String(init?.body)).input[0].content[0].type,
          "input_image",
        );
        return response(value);
      },
    },
  );
  assert.equal(result.fields.amount, null);
  assert.equal(result.fields.invoiceNumber?.value, "INV-12");
});

test("missing configuration and unsupported files fail before the transport", async () => {
  const fetcher: typeof fetch = async () => {
    throw new Error("Must not be called");
  };
  await assert.rejects(
    readDocumentWithAI(document, { apiKey: "", fetcher }),
    failsWith("EXTRACTION_NOT_CONFIGURED"),
  );
  await assert.rejects(
    readDocumentWithAI(
      { ...document, documentType: "text/plain" },
      { apiKey: "test-only", fetcher },
    ),
    failsWith("UNSUPPORTED_DOCUMENT"),
  );
});

test("transport, authentication and quota failures never become fabricated invoice values", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(
      readDocumentWithAI(document, {
        apiKey: "test-only",
        fetcher: async () => new Response("", { status }),
      }),
      failsWith("EXTRACTION_UNAVAILABLE"),
    );
  }
  await assert.rejects(
    readDocumentWithAI(document, {
      apiKey: "test-only",
      fetcher: async () => {
        throw new Error("timeout");
      },
    }),
    failsWith("EXTRACTION_UNAVAILABLE"),
  );
});

test("incomplete, refused, malformed and unsupported evidence is rejected", async () => {
  for (const body of [
    { status: "incomplete" },
    { status: "completed", output: [{ content: [{ type: "refusal" }] }] },
  ]) {
    await assert.rejects(
      readDocumentWithAI(document, {
        apiKey: "test-only",
        fetcher: async () => new Response(JSON.stringify(body)),
      }),
      failsWith("EXTRACTION_INVALID_RESPONSE"),
    );
  }
  const invalid = report();
  invalid.fields.amount!.source.page = 0;
  for (const value of [{}, invalid]) {
    await assert.rejects(
      readDocumentWithAI(document, {
        apiKey: "test-only",
        fetcher: async () => response(value),
      }),
      failsWith("EXTRACTION_INVALID_RESPONSE"),
    );
  }
  await assert.rejects(
    readDocumentWithAI(document, {
      apiKey: "test-only",
      fetcher: async () => response({ ...report(), documentKind: "OTHER" }),
    }),
    failsWith("NOT_AN_INVOICE"),
  );
});

test("unknown uploads never silently fall back to regex; offline parsing requires explicit opt-in", async () => {
  const key = process.env.OPENAI_API_KEY,
    mode = process.env.BILL_EXTRACTION_MODE;
  try {
    process.env.OPENAI_API_KEY = "";
    delete process.env.BILL_EXTRACTION_MODE;
    await assert.rejects(
      understand(document),
      failsWith("EXTRACTION_NOT_CONFIGURED"),
    );
    assert.match(
      (await understand({ documentName: "demo", sampleKey: "happy" })).provider,
      /fixture/,
    );
    process.env.BILL_EXTRACTION_MODE = "offline";
    assert.match(
      (await understand(document)).provider,
      /Limited offline reader/,
    );
  } finally {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    if (mode === undefined) delete process.env.BILL_EXTRACTION_MODE;
    else process.env.BILL_EXTRACTION_MODE = mode;
  }
});
