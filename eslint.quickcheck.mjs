// Minimal no-undef gate. Vite builds happily ship code that references
// undefined globals — "CALENDARS is not defined" reached production tonight
// with a green build. This catches that class before packaging.
import js from "@eslint/js";
export default [
  { ignores: ["dist/**", "node_modules/**"] },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: {
      ecmaVersion: 2022, sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { window: "readonly", document: "readonly", fetch: "readonly",
                 console: "readonly", localStorage: "readonly", sessionStorage: "readonly",
                 URLSearchParams: "readonly", navigator: "readonly", alert: "readonly",
                 confirm: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
                 setInterval: "readonly", clearInterval: "readonly", Blob: "readonly",
                 URL: "readonly", FileReader: "readonly", history: "readonly",
                 location: "readonly", requestAnimationFrame: "readonly" },
    },
    rules: { "no-undef": "error" },
  },
];
