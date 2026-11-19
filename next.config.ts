import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  turbopack: { root: process.cwd() },
  serverExternalPackages: ["@prisma/client", "pdf-parse", "playwright"],
};
export default config;
