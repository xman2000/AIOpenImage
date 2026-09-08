import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "dist-electron/", "release-installer/", "build/"]
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.es2021 },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ]
    }
  },

  // Renderer: browser globals, React rules, JSX transform means no React import needed.
  {
    files: ["src/renderer/**/*.{ts,tsx}", "vite.config.ts"],
    ...react.configs.flat.recommended,
    settings: { react: { version: "detect" } },
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser }
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      "react-hooks": reactHooks
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs["recommended-latest"].rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      // The loading-screen choreography drives its own state from effects. Fixing this
      // properly means reworking the boot sequence (which also carries ~5.2s of
      // deliberate delay), so it is tracked as a warning rather than suppressed.
      "react-hooks/set-state-in-effect": "warn"
    }
  },

  // Main process and preload: Node globals, no browser.
  {
    files: ["electron/**/*.ts", "src/main/**/*.ts"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
);
