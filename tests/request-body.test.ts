import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readBody,
  readJson,
  readUpload,
  RequestBodyError,
} from "../src/lib/request-body";

function streamedRequest(chunks: string[], contentLength?: string) {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/bills", {
    method: "POST",
    headers: contentLength ? { "Content-Length": contentLength } : {},
    body,
    duplex: "half",
  } as RequestInit);
  return { request, cancelled: () => cancelled };
}

test("body limits count streamed bytes even without a truthful Content-Length", async () => {
  for (const header of [undefined, "1"]) {
    const input = streamedRequest(["1234", "5678", "more", "data"], header);
    await assert.rejects(
      () => readBody(input.request, 6),
      (error: unknown) =>
        error instanceof RequestBodyError && error.status === 413,
    );
    assert.equal(input.cancelled(), true);
  }
});

test("oversize declared bodies are cancelled and exact byte limits are accepted", async () => {
  const oversized = streamedRequest(["123"], "999");
  await assert.rejects(() => readBody(oversized.request, 6), RequestBodyError);
  assert.equal(oversized.cancelled(), true);
  const exact = streamedRequest(["é", "abcd"]);
  assert.equal(
    new TextDecoder().decode(await readBody(exact.request, 6)),
    "éabcd",
  );
});

test("JSON and multipart readers preserve valid data and reject malformed bodies", async () => {
  assert.deepEqual(
    await readJson(streamedRequest(['{"action":', '"advance"}']).request),
    { action: "advance" },
  );
  await assert.rejects(
    () => readJson(streamedRequest(["not-json"]).request),
    /Invalid JSON/,
  );
  const form = new FormData();
  form.set(
    "file",
    new File(["%PDF-content"], "bill.pdf", { type: "application/pdf" }),
  );
  const parsed = await readUpload(
    new Request("http://localhost", { method: "POST", body: form }),
  );
  const file = parsed.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "bill.pdf");
  assert.equal(await file.text(), "%PDF-content");
});
