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
);
