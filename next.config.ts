import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; load it from node_modules instead of bundling.
  // Tesseract runs in worker threads from its own files; unpdf ships pdf.js. Both load from node_modules too.
  serverExternalPackages: ["@electric-sql/pglite", "tesseract.js", "unpdf"],
  // Pin the project root (a package-lock.json higher up the tree would otherwise be picked).
  turbopack: { root: __dirname },
  // Let phones on your Wi-Fi load the dev server, e.g. DEV_ALLOWED_ORIGINS=192.168.1.20 (dev only).
  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean),
};

export default nextConfig;
