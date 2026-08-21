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
    // DES-VISION-001 §2.11 — the no-raw-color contract. No file in src/ ships
    // a literal color: hex, or rgb()/hsl() with literal channel values. Colors
    // come from the semantic tokens in src/styles/tokens.css (a .css file —
    // outside ESLint's reach; its build-time twin, the PostCSS check, lands
    // with the error-mode flip). Slice-1 posture is WARN (§2.11 migration):
    // the ~40 inherited hardcoded colors are converted slice by slice, and the
    // rule moves to error per-surface as each slice lands, global by slice 6.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'warn',
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
      ],
    },
  },
);
