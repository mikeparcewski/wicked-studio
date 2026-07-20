/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
