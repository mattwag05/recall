import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Same files eslint-config-next registers the react-hooks plugin for; a bare
    // rules object also matches .cjs files, where the plugin is not defined.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
    rules: {
      // Over-eager on data-fetching effects: it flags setState that actually
      // runs *after* an await (post-fetch), which is a legitimate pattern here.
      // Keep it visible as a warning rather than failing the build.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // CommonJS scripts (run with plain node in the image) use require().
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
