/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // DES-VISION-001 §2.12 — every color class below is a SEMANTIC ALIAS
        // resolved at runtime from the CSS custom properties in
        // src/styles/tokens.css (the single source of truth): `bg-surface-card`,
        // `text-ink-body`, `border-status-gate`, … No Tailwind color is
        // hardcoded; a theme override or accent customization recolors these
        // classes with zero component changes.
        surface: {
          base: 'var(--surface-base)',
          rail: 'var(--surface-rail)',
          card: 'var(--surface-card)',
          raised: 'var(--surface-raised)',
          overlay: 'var(--surface-overlay)',
        },
        ink: {
          dim: 'var(--ink-dim)',
          muted: 'var(--ink-muted)',
          body: 'var(--ink-body)',
          high: 'var(--ink-high)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          dim: 'var(--accent-dim)',
          subtle: 'var(--accent-subtle)',
          fg: 'var(--accent-fg)',
        },
        status: {
          gate: 'var(--status-gate)',
          'gate-dim': 'var(--status-gate-dim)',
          fail: 'var(--status-fail)',
          'fail-dim': 'var(--status-fail-dim)',
          run: 'var(--status-run)',
          'run-dim': 'var(--status-run-dim)',
          done: 'var(--status-done)',
          'done-dim': 'var(--status-done-dim)',
        },
        // The inherited `wk` shell palette retired with DES-VISION-001 slice 6 —
        // its last consumers moved onto the semantic aliases above.
      },
    },
  },
  plugins: [],
};
