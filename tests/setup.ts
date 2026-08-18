import '@testing-library/jest-dom';

// jsdom does not implement scrollIntoView — stub it only when missing.
if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

// This jsdom build exposes no localStorage (opaque-origin / node flag gap), while every
// browser the SPA ships to does. Stub the same shape so storage-backed behaviour is
// TESTED rather than silently falling through the production try/catch guards.
if (!('localStorage' in window) || window.localStorage == null) {
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
