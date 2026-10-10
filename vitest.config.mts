import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: {
      "@collectors": fileURLToPath(new URL("./collectors", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    } },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "collectors/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000, // each DB suite boots its own PGlite and applies every migration
  },
});
