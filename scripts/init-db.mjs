import { existsSync, mkdirSync, writeFileSync, copyFileSync } from "node:fs";
mkdirSync("prisma", { recursive: true });
if (!existsSync(".env")) copyFileSync(".env.example", ".env");
if (!existsSync("prisma/demo.db")) writeFileSync("prisma/demo.db", "");
