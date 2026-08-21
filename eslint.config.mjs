// Flat ESLint config for wicked-studio (React SPA).
//
// Carried over from the wicked-crew workspace config this package used to be
// linted by (the extraction preserved the rule set so the carve changed the
// repo boundary, not the bar): typescript-eslint's `recommended` set —
// correctness-focused, not opinionated style — plus the Rules of Hooks (a real
// bug class) with exhaustive-deps advisory so intentional per-line disables
// stay valid. No type-info project wiring, so it runs the same locally and in CI.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// DES-VISION-001 §2.11 — the no-raw-color contract's selectors. No file in
// src/ ships a literal color: hex, or rgb()/hsl() with literal channel values.
// Colors come from the semantic tokens in src/styles/tokens.css (a .css file —
// outside ESLint's reach; its build-time twin, the PostCSS check in
// postcss.config.js, covers the stylesheets). Slice 6 finished the migration:
// the rule is ERROR for all of src/ — a raw color anywhere is a build failure,
// not a review finding. The per-file TOKEN_CLEAN allowlist that staged the
// slice-by-slice conversion is retired.
const NO_RAW_COLOR = [
  {
    selector: 'Literal[value=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
    message: 'Raw hex color — use a semantic token from src/styles/tokens.css, e.g. var(--surface-card) (DES-VISION-001 §2.11).',
  },
  {
    selector: 'TemplateElement[value.raw=/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b/]',
    message: 'Raw hex color — use a semantic token from src/styles/tokens.css, e.g. var(--surface-card) (DES-VISION-001 §2.11).',
  },
  {
    selector: 'Literal[value=/\\brgba?\\(\\s*[0-9]/]',
    message: 'rgb()/rgba() with literal values — use a semantic token from src/styles/tokens.css (DES-VISION-001 §2.11).',
  },
  {
    selector: 'TemplateElement[value.raw=/\\brgba?\\(\\s*[0-9]/]',
    message: 'rgb()/rgba() with literal values — use a semantic token from src/styles/tokens.css (DES-VISION-001 §2.11).',
  },
  {
    selector: 'Literal[value=/\\bhsla?\\(\\s*[0-9.]/]',
    message: 'hsl()/hsla() with literal values — use a semantic token from src/styles/tokens.css (DES-VISION-001 §2.11).',
  },
  {
    selector: 'TemplateElement[value.raw=/\\bhsla?\\(\\s*[0-9.]/]',
    message: 'hsl()/hsla() with literal values — use a semantic token from src/styles/tokens.css (DES-VISION-001 §2.11).',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '*.config.{js,cjs,mjs,ts}',
      'scripts/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...NO_RAW_COLOR],
    },
  },
);
