/// <reference types="astro/client" />

/**
 * Build-time constant injected by astro.config.mjs (vite define) from the
 * repo's package.json — the published `wicked-studio` npm manifest. Keeps the
 * site's install-CTA version stamp true by construction (DT-7).
 */
declare const __WICKED_STUDIO_VERSION__: string;
