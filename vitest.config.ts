import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The same `@/` the app and tsconfig use, so a test imports what ships.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // The Deno runtime has its own runner (`deno test`); ADR-0013 keeps the two
    // apart.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      // CODING_STANDARDS.md §3: 100% branch coverage for the pure seams, and none
      // asked of the thin I/O adapters. So the bar is measured over the seams and
      // nowhere else — src/lib/supabase holds the server client and the session
      // refresh, whose wiring is covered against a real stack by
      // tests/session-refresh.test.ts.
      enabled: true,
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: [
        "src/lib/database.types.ts",
        "src/lib/supabase/**",
        "src/lib/**/*.test.ts",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
