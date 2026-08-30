import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["packages/*/src/**/*.ts", "apps/control-plane/src/**/*.ts"],
      reporter: ["text", "json-summary"],
    },
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts"],
    passWithNoTests: false,
  },
});
