import tseslint from "typescript-eslint";
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "test-results/**",
      "playwright-report/**",
      ".local-db/**",
      "data/**", // Runtime storage and verified release/backup artifacts, not source.
      "apps/web/public/tool-assets/pdfjs/**", // Unmodified, generated PDF.js distribution assets.
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
