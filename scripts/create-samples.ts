import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { sampleExtraction } from "../src/ai/samples";
// Node-only generator keeps setup portable; Python is not required to run this app.
async function main() {
  await mkdir("public/samples", { recursive: true });
  for (const key of ["happy", "approval", "ambiguous", "failure"]) {
    const fields = sampleExtraction(key);
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const ink = rgb(0.21, 0.33, 0.42),
      muted = rgb(0.51, 0.58, 0.63),
      line = rgb(0.88, 0.91, 0.93);
    const text = (
      value: string,
      x: number,
      y: number,
      size = 10,
      heavy = false,
      color = muted,
    ) =>
      page.drawText(value, { x, y, size, font: heavy ? bold : regular, color });
    const right = (
      value: string,
      x: number,
      y: number,
      size = 10,
      heavy = false,
      color = muted,
    ) =>
      text(
        value,
        x - (heavy ? bold : regular).widthOfTextAtSize(value, size),
        y,
        size,
        heavy,
        color,
      );
    const rule = (y: number) =>
      page.drawLine({
        start: { x: 54, y },
        end: { x: 558, y },
        thickness: 1,
        color: line,
      });
    doc.setTitle(`DSD sample invoice - ${key}`);
    text(fields.vendorName!.value, 54, 713, 23, true, ink);
    text("ACCOUNT STATEMENT / PROPERTY SERVICES", 54, 691, 9);
    rule(667);
    text("SERVICE LOCATION", 54, 632, 8);
    text("INVOICE NUMBER", 358, 632, 8);
    text(fields.serviceAddress!.value, 54, 612, 11, false, ink);
    text(fields.invoiceNumber!.value, 358, 612, 11, false, ink);
    text("DSD Property Group", 54, 592);
    text("ACCOUNT NUMBER", 358, 581, 8);
    text(fields.accountNumber!.value, 358, 563, 11, false, ink);
    page.drawRectangle({
      x: 54,
      y: 499,
      width: 504,
      height: 28,
      color: rgb(0.945, 0.96, 0.97),
    });
    text("DESCRIPTION", 65, 509, 9);
    right("AMOUNT", 545, 509, 9);
    const amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(fields.amount!.value);
    text("Property services - current billing period", 65, 475, 11, false, ink);
    right(amount, 545, 475, 11, false, ink);
    rule(450);
    text("AMOUNT DUE", 354, 414);
    right(amount, 558, 380, 25, true, ink);
    right(`Please pay by ${fields.dueDate!.value}`, 558, 357);
    if (key === "ambiguous")
      text(
        "Service location: Main St, Dallas. Account reference unclear.",
        54,
        287,
        10,
        false,
        rgb(0.63, 0.53, 0.34),
      );
    rule(125);
    text(
      "SAMPLE DOCUMENT - FOR DEMONSTRATION ONLY - NO REAL PAYMENT",
      119,
      105,
      8,
    );
    await writeFile(`public/samples/${key}.pdf`, await doc.save());
    await writeFile(
      `public/samples/${key}.json`,
      JSON.stringify(fields, null, 2),
    );
  }
  console.log("Four sample invoices regenerated with due dates 21 days ahead.");
}
main();
