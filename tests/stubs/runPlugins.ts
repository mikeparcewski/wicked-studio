/** The test stand-in for `virtual:wicked-run-plugins` (vite.config.ts): a jsdom frame never runs a plugin. */
export default {
  'wicked-phase-report': { version: '0.0.0-test', html: '<!doctype html><title>stub</title>', sha256: '0'.repeat(64) },
} as Record<string, { version: string; html: string; sha256: string }>;
