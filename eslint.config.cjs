const js = require("@eslint/js");
const globals = require("globals");
const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const runtimeCoreFiles = ["packages/runtime-core/src/**/*.ts", "src/**/*.ts"];

const tsEslintRecommendedRules =
  tsPlugin.configs["eslint-recommended"].overrides[0].rules;

module.exports = [
  {
    ignores: [
      "**/coverage/**",
      "**/*.bench.ts",
      "**/*.test.ts",
      "**/dist/**",
      "**/node_modules/**",
      ".turbo/**",
      "coverage/**",
      "data/**",
      "docs.notpublished/**",
      "examples/**/behaviors/**",
      "internal/**",
      "memory/**",
      "packages/docs/dist/**",
      "packages/runtime-core/src/renderer/generated/**",
      "packages/runtime-core/src/renderer/styles/tailwind.generated.ts",
      "packages/runtime-node/tests/**",
      "packages/runtime-worker/src/test-helpers/**",
      "packages/runtime-worker/tests/**"
    ]
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts,cts}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  js.configs.recommended,
  {
    // ESLint 10 enables additional core rules that are unrelated to this
    // tooling phase. Keep the existing repo baseline until we address them
    // deliberately in a dedicated cleanup pass.
    rules: {
      "no-useless-assignment": "off",
      "preserve-caught-error": "off"
    }
  },
  {
    files: tsFiles,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsEslintRecommendedRules,
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  {
    files: [
      "packages/notifications/src/**/*.ts",
      "packages/plugin-sdk/src/**/*.ts",
      "packages/runtime-hono/src/**/*.ts",
      "packages/runtime-node/src/**/*.ts",
      "packages/runtime-simulator/src/**/*.ts",
      "packages/runtime-worker/src/**/*.ts",
      "plugins/card-grid-layout/src/**/*.ts"
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    files: runtimeCoreFiles,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message:
                "Node.js built-in imports are not allowed in runtime-core. This package must be platform-agnostic."
            },
            {
              group: [
                "fs",
                "path",
                "crypto",
                "events",
                "http",
                "https",
                "net",
                "stream",
                "os",
                "process"
              ],
              message:
                "Node.js built-in modules are not allowed in runtime-core. Use Web APIs instead."
            }
          ]
        }
      ]
    }
  },
  {
    files: runtimeCoreFiles,
    rules: {
      "@typescript-eslint/no-explicit-any": "off"
    }
  }
];
