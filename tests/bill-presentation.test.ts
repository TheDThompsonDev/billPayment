import { test } from "node:test";
import assert from "node:assert/strict";
import { presentBill } from "../src/services/bill-presentation";

test("bill presentation excludes internal file locations and reservation tokens without mutating storage records", () => {
  const bill = {
    id: "invoice-1",
    documentPath: "C:/private/storage/document",
    documentHash: "internal-hash",
    navigation: { runToken: "secret-token", status: "RUNNING" },
  };
  const output = presentBill(bill);
  assert.deepEqual(output, {
    id: "invoice-1",
    hasDocument: true,
    navigation: { status: "RUNNING" },
  });
  assert.equal(bill.navigation.runToken, "secret-token");
  assert.equal(
    presentBill({ ...bill, documentPath: null, navigation: null }).hasDocument,
    false,
  );
});
