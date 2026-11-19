import {
  existsSync,
  copyFileSync,
  unlinkSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
const root = process.cwd();
const database = path.resolve(root, "prisma", "demo.db");
if (
  !database.startsWith(root + path.sep) ||
  JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).name !==
    "dsd-property-bill-automation"
)
  throw new Error("Run demo:reset from the billPayment project directory.");
if (existsSync(database)) {
  mkdirSync(path.join(root, "storage", "backups"), { recursive: true });
  const backup = path.join(root, "storage", "backups", `demo-${Date.now()}.db`);
  copyFileSync(database, backup);
  unlinkSync(database);
  console.log(
    `Previous demo database backed up to ${backup}. Uploaded files retained.`,
  );
}
