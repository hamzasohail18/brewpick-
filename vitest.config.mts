import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts", "collectors/**/*.test.ts", "scripts/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
