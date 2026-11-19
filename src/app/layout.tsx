import type { Metadata } from "next";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./globals.css";
import { db } from "@/database/client";
import { currentUser } from "@/services/session";
import { Shell } from "@/components/shell";
export const metadata: Metadata = {
  title: "DSD · Property Bill Automation",
  description:
    "Confident bill processing for property operations. A safe, fully simulated demonstration.",
};
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [review, approvals, user] = await Promise.all([
    db.bill.count({ where: { status: "NEEDS_REVIEW" } }),
    db.bill.count({ where: { status: "AWAITING_APPROVAL" } }),
    currentUser(),
  ]);
  return (
    <html lang="en">
      <body>
        <Shell
          counts={{ review, approvals }}
          user={user}
          livePaymentsEnabled={
            process.env.PAYMENT_BROWSER_LIVE_ENABLED === "true"
          }
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
