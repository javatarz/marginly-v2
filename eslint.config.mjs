import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  {
    // The Deno runtime is linted by `deno check`, and generated files are not
    // ours to fix.
    ignores: [
      ".next/**",
      "coverage/**",
      "supabase/functions/**",
      "supabase/.temp/**",
      "src/lib/database.types.ts",
      "next-env.d.ts",
    ],
  },
  ...coreWebVitals,
  ...typescript,
];

export default config;
