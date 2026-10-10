import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM + data files; load it from node_modules instead of bundling.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Pin the project root (a package-lock.json higher up the tree would otherwise be picked).
  turbopack: { root: __dirname },
};

export default nextConfig;
