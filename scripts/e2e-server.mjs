import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
mkdirSync("storage", { recursive: true });
const target = path.resolve("storage", `e2e-${Date.now()}.db`);
writeFileSync(target, "");
const env = {
  ...process.env,
  DATABASE_URL: `file:${target.replaceAll("\\", "/")}`,
  OPENAI_API_KEY: "",
  BILL_EXTRACTION_MODE: "offline",
  PAYMENT_DEMO_ORIGIN: "http://127.0.0.1:3001",
  PAYMENT_BROWSER_LIVE_ENABLED: "false",
};
execFileSync(
  process.execPath,
  ["node_modules/prisma/build/index.js", "db", "push", "--skip-generate"],
  { env, stdio: "inherit" },
);
execFileSync(process.execPath, ["--import", "tsx", "src/database/seed.ts"], {
  env,
  stdio: "inherit",
});
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3001",
  ],
  { env, stdio: "inherit" },
);
process.on("SIGTERM", () => server.kill());
process.on("SIGINT", () => server.kill());
server.on("exit", (code) => process.exit(code ?? 0));
