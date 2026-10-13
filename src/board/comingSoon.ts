/**
 * What studio shows as coming, never as working (operator 2026-10-12). The app builder ("vibe") is
 * not built: apps are built by pipelines today, and a visual over them needs its own design. Where an
 * app builder would be offered — the Plugins page list and the New job cards — it is listed with
 * these words, disabled, with no link and nothing behind it.
 */
export const VIBE_SOON = {
  name: 'Vibe — app builder',
  line: 'Build and preview an app visually. Apps are already built by pipelines today.',
} as const;
