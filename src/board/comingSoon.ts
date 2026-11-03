/**
 * What studio shows as coming, never as working (operator 2026-10-12). The data builder is not built
 * (operator 2026-11-02: it is "Apps", a live app or dashboard over your APIs and databases; was
 * "Vibe"). Where it would be offered — the Plugins page list, and New job on a daemon whose catalog
 * does not list it — it is listed with these words, disabled, with no link and nothing behind it.
 * On a daemon with the catalog, crew's own `apps` card says it.
 */
export const VIBE_SOON = {
  name: 'Apps',
  line: 'A live app or dashboard over your APIs and databases.',
} as const;
