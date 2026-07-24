import js from "@eslint/js";

export default [
  {
    // Deno handlers run under a different runtime; they're checked by `deno check`, not eslint.
    // dist/ is generated.
    ignores: ["src/deno/**", "dist/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { process: "readonly", console: "readonly", URL: "readonly" },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
