import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The Deno runtime has its own runner (`deno test`); ADR-0013 keeps the two
    // apart.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      // CODING_STANDARDS.md §3: 100% branch coverage for the pure seams, and none
      // asked of the thin adapters — so the bar is measured over src/lib, where
      // the seams live, and nowhere else.
      enabled: true,
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/database.types.ts", "src/lib/**/*.test.ts"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
