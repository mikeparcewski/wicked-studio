import '@testing-library/jest-dom';

// A few suites opt out of the suite-wide jsdom env (`@vitest-environment node` — e.g.
// tests/testidInventory.test.ts, pure filesystem). This setup file still runs for them;
// every stub below patches jsdom gaps, so skip the lot when there is no window at all.
const hasDom = typeof window !== 'undefined';

// jsdom does not implement scrollIntoView — stub it only when missing.
if (hasDom && typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// This jsdom build exposes no localStorage (opaque-origin / node flag gap), while every
// browser the SPA ships to does. Stub the same shape so storage-backed behaviour is
// TESTED rather than silently falling through the production try/catch guards.
if (hasDom && (!('localStorage' in window) || window.localStorage == null)) {
  const mem = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, String(v)),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: (i: number) => [...mem.keys()][i] ?? null,
      get length() { return mem.size; },
    },
  });
}

// jsdom implements no canvas backend; components that probe a 2D context (and any
// dependency that measures text through one) throw "Not implemented" on CI where the
// optional native canvas package is absent. Stub only when missing, same policy as above.
if (hasDom &&
    (typeof window.HTMLCanvasElement.prototype.getContext !== 'function' ||
    (() => { try { return document.createElement('canvas').getContext('2d') == null; } catch { return true; } })())) {
  window.HTMLCanvasElement.prototype.getContext = (() => ({
    measureText: (t: string) => ({ width: String(t).length * 7 }),
    fillText: () => {}, clearRect: () => {}, fillRect: () => {},
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
    arc: () => {}, closePath: () => {},
    save: () => {}, restore: () => {}, scale: () => {}, translate: () => {},
  })) as unknown as typeof window.HTMLCanvasElement.prototype.getContext;
}
