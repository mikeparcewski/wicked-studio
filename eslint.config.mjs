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
// outside ESLint's reach; its build-time twin, the PostCSS check, lands with
// the global error-mode flip). One list, two postures below: WARN as the
// migration baseline (§2.11 — the inherited hardcoded colors are converted
// slice by slice), ERROR for every file a landed slice has converted.
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

// Files a landed slice has fully converted — the rule is ERROR here, and a raw
// color is a build failure, not a review finding (§6.0). Grows slice by slice
// until slice 6 flips src/** wholesale and this list retires.
const TOKEN_CLEAN = [
  // Vision slice 2 — the orchestrator home (§5.1).
  'src/components/HomeBoard.tsx',
  'src/components/LiveFeed.tsx',
  'src/components/ProjectCard.tsx',
  'src/components/GateChip.tsx',
  'src/hooks/useBoardHeadline.ts',
  // Vision slice 3 — the chrome + mode switcher (§3.1, §5.2).
  'src/components/AppChrome.tsx',
  'src/components/WickedLogo.tsx',
  'src/components/LeftSidebar.tsx',
  'src/components/SettingsMenu.tsx',
  'src/components/ModeSwitcher.tsx',
  'src/components/ProjectShell.tsx',
  // Vision slice 4 — the Chat + Build surfaces (§5.3, §5.4).
  'src/components/GroupChat.tsx',
  'src/components/ChatPanel.tsx',
  'src/components/CenterDashboard.tsx',
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
      'no-restricted-syntax': ['warn', ...NO_RAW_COLOR],
    },
  },
  {
    files: TOKEN_CLEAN,
    rules: {
      'no-restricted-syntax': ['error', ...NO_RAW_COLOR],
    },
  },
);
