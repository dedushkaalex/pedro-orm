import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  lint: {
    ignorePatterns: ["dist/**", "node_modules/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      // Полезно для Effect TS: эффекты не должны теряться без обработки
      "typescript/no-floating-promises": "error",
      "typescript/no-misused-promises": "error",
      "typescript/await-thenable": "error",
      "typescript/only-throw-error": "error",
      "typescript/no-base-to-string": "error",

      // Строгая типизация — Effect полагается на точные типы
      "typescript/no-explicit-any": "error",
      "typescript/no-non-null-assertion": "error",
      "typescript/no-non-null-asserted-optional-chain": "error",

      // Чистые импорты для лучшего tree-shaking модулей Effect
      "typescript/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "typescript/no-import-type-side-effects": "error",

      // Общие правила качества
      "eslint/no-throw-literal": "error",
      "eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "unicorn/no-unnecessary-await": "error",
      "unicorn/no-await-in-promise-methods": "error",
    },
  },
  fmt: {
    ignorePatterns: ["dist/**", "node_modules/**", "pnpm-lock.yaml"],
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    printWidth: 100,
    tabWidth: 2,
    useTabs: false,
    arrowParens: "always",
    bracketSpacing: true,
    endOfLine: "lf",
    sortPackageJson: true,
  },
});
