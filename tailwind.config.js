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
        // The INHERITED shell palette — consumed by today's components; slices
        // 2–6 migrate them onto the semantic aliases above, then this retires.
        wk: {
          canvas:       '#0d1117',
          'canvas-2':   '#161c26',
          surface:      '#1b222e',
          'surface-2':  '#0f1419',
          ink:          '#e6edf3',
          accent:       '#ffda19',
          'accent-ink': '#0d1117',
          link:         '#79c0ff',
          ok:           '#3fb950',
          deny:         '#f85149',
          muted:        'rgba(230,237,243,0.55)',
          blue:         '#1c4053',
          'blue-2':     '#182f3c',
          'blue-s':     '#224a5e',
          'blue-s2':    '#1a3b4e',
        },
      },
    },
  },
  plugins: [],
};
