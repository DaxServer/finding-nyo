import js from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import globals from "globals";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  // Browser globals for frontend Vue files
  {
    files: ["frontend/**/*.{vue,ts}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  // Vue file TypeScript parser + relax opinionated formatting
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": ["warn", { html: { void: "never" } }],
    },
  },
  {
    ignores: ["public/", "node_modules/"],
  }
);
