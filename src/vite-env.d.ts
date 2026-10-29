/// <reference types="vite/client" />

/** The first-party run-thread plugins, built into studio's bundle (vite.config.ts `runPluginsModule`). */
declare module 'virtual:wicked-run-plugins' {
  const bundles: Record<string, { version: string; html: string; sha256: string }>;
  export default bundles;
}
