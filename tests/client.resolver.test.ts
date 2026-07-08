// Unit test: origin-aware API base resolver (DES-STUDIO-SERVING-001 §4.2, §6.2).
//
// AC-7: prod / daemon-served (same-origin) — no VITE_API_HOST, so the resolver
//       derives REST/WS from window.location (proves no hardcoded 7701 ships).
// AC-8: dev split — VITE_API_HOST set → the dev override wins over location.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBase, wsBase, terminalWsUrl } from '../src/api/client.js';

/** Point jsdom's window.location at an arbitrary origin for the test. */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('API base resolver — same-origin (prod, no VITE_API_HOST)', () => {
  it('AC-7: derives REST base from window.location origin (:7788, not a 7701 literal)', () => {
    vi.stubEnv('VITE_API_HOST', '');
    setLocation('http://127.0.0.1:7788/');
    expect(apiBase()).toBe('http://127.0.0.1:7788/api/v1');
  });

  it('AC-7: derives the WS base (and terminal WS url) from the same origin', () => {
    vi.stubEnv('VITE_API_HOST', '');
    setLocation('http://127.0.0.1:7788/');
    expect(wsBase()).toBe('ws://127.0.0.1:7788');
    expect(terminalWsUrl('t-1')).toBe('ws://127.0.0.1:7788/ws/terminals/t-1');
  });

  it('AC-7: uses wss:// when the page is served over https', () => {
    vi.stubEnv('VITE_API_HOST', '');
    setLocation('https://studio.example.com:8443/');
    expect(apiBase()).toBe('https://studio.example.com:8443/api/v1');
    expect(wsBase()).toBe('wss://studio.example.com:8443');
  });
});

describe('API base resolver — dev split (VITE_API_HOST override)', () => {
  it('AC-8: the dev override wins over window.location for REST', () => {
    vi.stubEnv('VITE_API_HOST', '127.0.0.1:7701');
    setLocation('http://127.0.0.1:4200/'); // dev server origin
    expect(apiBase()).toBe('http://127.0.0.1:7701/api/v1');
  });

  it('AC-8: the dev override wins for WS + terminal WS url', () => {
    vi.stubEnv('VITE_API_HOST', '127.0.0.1:7701');
    setLocation('http://127.0.0.1:4200/');
    expect(wsBase()).toBe('ws://127.0.0.1:7701');
    expect(terminalWsUrl('abc def')).toBe('ws://127.0.0.1:7701/ws/terminals/abc%20def');
  });
});
