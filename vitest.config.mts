import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  test: {
    environment: "node",
    include: [
      "tests/unit/**/*.test.ts",
      "tests/contracts/**/*.test.ts",
      "tests/auth/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/coverage/**",
      "tests/e2e/**",
    ],
    clearMocks: true,
  },
});
