import { db } from "./client";
import { policyDefinitions } from "../domain/approvals/approval-policy";
import { confirmedExtraction } from "../domain/bills/types";
import { sampleExtraction } from "../ai/samples";
import { duplicateKey } from "../domain/bills/duplicate-check";
import { advanceBill } from "../workflows/bill-workflow";
const properties = [
  [
    "main",
    "Main Street Residences",
    "123 Main Street, Dallas, TX",
    "Dallas",
    48,
  ],
  ["oak", "Oak Avenue Apartments", "875 Oak Avenue, Plano, TX", "Plano", 64],
  ["preston", "Preston Commons", "4100 Preston Road, Frisco, TX", "Frisco", 92],
  ["elm", "The Elm House", "29 Elm Street, Dallas, TX", "Dallas", 24],
  [
    "main-north",
    "Main Street North",
    "125 Main Street, Dallas, TX",
    "Dallas",
    36,
  ],
  [
    "cedar",
    "Cedar Park Villas",
    "610 Cedar Lane, Richardson, TX",
    "Richardson",
    72,
  ],
  ["lake", "Lakeside Terrace", "240 Lake Drive, Rockwall, TX", "Rockwall", 56],
  ["maple", "Maple Court", "820 Maple Avenue, Dallas, TX", "Dallas", 32],
  ["willow", "Willow Creek", "190 Willow Lane, Irving, TX", "Irving", 80],
  ["park", "Parkside Lofts", "500 Park Boulevard, Plano, TX", "Plano", 44],
  ["river", "Riverbend Place", "350 River Road, Allen, TX", "Allen", 60],
  [
    "stone",
    "Stonebridge Square",
    "720 Stonebridge Drive, McKinney, TX",
    "McKinney",
    88,
  ],
] as const;
const vendors = [
  ["water", "Dallas Water Utilities", "UTILITY", "ACH"],
  ["oncor", "Oncor", "UTILITY", "PORTAL"],
  ["atmos", "Atmos Energy", "UTILITY", "CREDIT_CARD"],
  ["plumbing", "Reliable Plumbing", "MAINTENANCE", "CHECK"],
  ["green", "GreenScape Landscaping", "LANDSCAPING", "ACH"],
  ["waste", "Metro Waste Services", "WASTE", "ACH"],
] as const;
async function main() {
  for (const user of [
    { id: "analyst", name: "Alex Morgan", role: "ANALYST" },
    { id: "manager", name: "Jamie Chen", role: "PROPERTY_MANAGER" },
    { id: "regional", name: "Sarah Mitchell", role: "REGIONAL_MANAGER" },
    { id: "director", name: "Morgan Davis", role: "DIRECTOR" },
  ])
    await db.user.upsert({ where: { id: user.id }, create: user, update: {} });
  for (const [id, name, address, city, units] of properties)
    await db.property.upsert({
      where: { id },
      create: { id, name, address, city, units },
      update: {},
    });
  for (const [id, name, category, paymentMethod] of vendors)
    await db.vendor.upsert({
      where: { id },
      create: { id, name, category, paymentMethod },
      update: {},
    });
  for (const policy of policyDefinitions)
    await db.approvalPolicy.upsert({
      where: { id: policy.id },
      create: policy,
      update: {},
    });
  for (let p = 0; p < properties.length; p++)
    for (let v = 0; v < vendors.length; v++) {
      const [vendorId, , , paymentMethod] = vendors[v];
      const propertyId = properties[p][0];
      const prefixes = ["DW", "ON", "AE", "RP", "GS", "MW"];
      await db.vendorAccount.upsert({
        where: { id: `${vendorId}-${propertyId}` },
        create: {
          id: `${vendorId}-${propertyId}`,
          vendorId,
          propertyId,
          number: `${prefixes[v]}-${1001 + p}`,
          paymentMethod,
        },
        update: {},
      });
    }
  if (await db.bill.count()) {
    console.log("Seed preserved: existing bills were not changed.");
    return;
  }
  const accounts = await db.vendorAccount.findMany({
    include: { vendor: true, property: true },
  });
  const now = new Date();
  for (let i = 0; i < 72; i++) {
    const account = accounts[i % accounts.length];
    const amountCents =
      account.vendorId === "water"
        ? 155000 + (i % 5) * 8000
        : account.vendorId === "plumbing"
          ? 650000 + (i % 3) * 50000
          : 34000 + (i % 9) * 18700;
    const createdAt = new Date(
      now.getFullYear(),
      now.getMonth() - (i < 48 ? 0 : 1),
      Math.max(1, now.getDate() - (i % 15)),
      8 + (i % 8),
      12,
    );
    const invoiceNumber = `HIST-${account.vendorId.toUpperCase()}-${1000 + i}`;
    const dueDate = new Date(now.getTime() + 14 * 86400000);
    const values = {
      vendorName: account.vendor.name,
      accountNumber: account.number,
      invoiceNumber,
      amount: amountCents / 100,
      dueDate: dueDate.toISOString().slice(0, 10),
      serviceAddress: account.property.address,
    };
    const fields = JSON.stringify(confirmedExtraction(values));
    await db.bill.create({
      data: {
        id: `history-${i}`,
        status: "PAID",
        stage: 4,
        source: "SEEDED_HISTORY",
        documentName: `${invoiceNumber}.pdf`,
        vendorId: account.vendorId,
        propertyId: account.propertyId,
        accountId: account.id,
        invoiceNumber,
        amountCents,
        dueDate,
        paymentMethod: account.paymentMethod,
        dedupeKey: duplicateKey(account.vendorId, account.id, invoiceNumber),
        confidence: 0.99,
        createdAt,
        extraction: {
          create: {
            fields,
            originalFields: fields,
            provider: "Seeded demo ledger",
          },
        },
        validation: JSON.stringify([
          "Historical fixture — imported as settled",
        ]),
        matching: JSON.stringify({
          method: "Imported historical account",
          confidence: 1,
          reasoning: "Seeded demonstration history.",
        }),
        payment: {
          create: {
            status: "COMPLETED",
            method: account.paymentMethod,
            amountCents,
            externalId: `SIM-HISTORY-${1000 + i}`,
            idempotencyKey: `history-${i}`,
            createdAt,
            completedAt: createdAt,
            attempts: {
              create: {
                number: 1,
                status: "COMPLETED",
                externalId: `SIM-HISTORY-${1000 + i}`,
                createdAt,
              },
            },
          },
        },
        events: {
          create: [
            {
              type: "HISTORY_IMPORTED",
              title: "Historical demo invoice imported",
              detail:
                "Synthetic settled history for operational metrics and amount comparisons; not a live workflow execution.",
              actor: "Demo seed",
              createdAt,
            },
            {
              type: "PAYMENT_COMPLETED",
              title: "Simulated historical payment",
              detail: `${account.paymentMethod} · SIM-HISTORY-${1000 + i}. No real funds transferred.`,
              actor: "Demo seed",
              createdAt,
            },
          ],
        },
      },
    });
  }
  for (let i = 0; i < 12; i++) {
    const key =
      i < 4 ? "approval" : i < 7 ? "ambiguous" : i === 7 ? "failure" : "happy";
    const extraction = sampleExtraction(key, `-SEED-${i}`);
    if (key === "happy") extraction.invoiceNumber!.value = `DW-QUEUE-${i}`;
    const fields = JSON.stringify(extraction);
    const bill = await db.bill.create({
      data: {
        source: "SAMPLE",
        sampleKey: key,
        documentName: `${key}-sample.pdf`,
        extraction: {
          create: { fields, originalFields: fields, provider: "Demo fixture" },
        },
        events: {
          create: {
            type: "BILL_UPLOADED",
            title: "Bill received",
            detail: "Sample invoice received into the demonstration workspace.",
            actor: "Alex Morgan",
          },
        },
      },
    });
    const steps = i === 11 ? 1 : 4;
    for (let s = 0; s < steps; s++) await advanceBill(bill.id);
    if (i === 7 || i === 10) {
      await advanceBill(bill.id);
      if (i === 7) {
        await new Promise((r) => setTimeout(r, 1200));
        await advanceBill(bill.id);
      }
    }
  }
  console.log(
    `Seeded ${await db.property.count()} properties, ${await db.vendor.count()} vendors, ${await db.bill.count()} bills.`,
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
