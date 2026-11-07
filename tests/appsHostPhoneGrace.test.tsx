import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppHostPort } from '../src/editors/apps/appAdapter.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';

/**
 * plugins G16 (operator ruling D5, codex r2/r3): a phone is view + chat. The host port's `editing()` decides whether a
 * spec op from the app's frame is taken; after Edit, a short grace lets a field blurred by clicking Preview still save.
 * That grace must end the moment Edit is taken away (the window becomes a phone), however the person left Edit.
 * EditorHost is replaced here by a stand-in that keeps the port the view hands it.
 */

const ports: AppHostPort[] = [];
vi.mock('../src/editors/host.js', async (orig) => {
  const real = await orig<typeof import('../src/editors/host.js')>();
  class FakeHost {
    constructor(opts: { app?: AppHostPort }) { if (opts.app !== undefined) ports.push(opts.app); }
    mount(): void {}
    teardown(): void {}
    setAppMode(): void {}
    setTheme(): void {}
    appChangedByHost(): void {}
  }
  return { ...real, EditorHost: FakeHost };
});

const { AppHostView } = await import('../src/components/editorHost/AppHostView.js');

/** A media query whose answer the test changes, telling every listener. */
function phoneQuery(): { set: (phone: boolean) => void } {
  let matches = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return q.includes('max-width') && matches; }, media: q,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return { set: (p) => { matches = p; for (const fn of [...listeners]) fn(); } };
}

const CAPS = { apps: { query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false } };
function crew(): void {
  const detail = {
    slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1, head: { version: 1, tree: 't1', receipt: 'you' }, turn: null,
    spec: structuredClone(SAMPLE_APPS['escalations']!.spec), lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {},
    versions: [{ version: 1, commit: 'c1', tree: 't1', base: null, at: 1, author: { kind: 'human', id: 'you' }, receipt: { kind: 'you', tree: 't1', version: 1, at: 1, actor: { id: 'you', kind: 'human', trust: 'operator' } }, summary: '', check: { level: 'spec', checked: [] } }],
    history: { states: [1], pointer: 0, canUndo: false, canRedo: false }, archived: null,
  };
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/apps/desk') return json({ app: detail });
    if (path === '/editors/wicked-apps/grants') return json({ grants: [] });
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
}

afterEach(() => { ports.length = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('a phone ends the Edit grace at once (codex r2, r3)', () => {
  it('Edit, then Preview, then a phone within the grace: editing() is false', async () => {
    const mq = phoneQuery();
    crew();
    render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} initialMode="edit" caps={{ apps: CAPS.apps }} />);
    await waitFor(() => expect(ports).toHaveLength(1));
    const port = ports[0]!;
    expect(port.editing!()).toBe(true);
    fireEvent.click(screen.getByTestId('apps-mode-preview'));
    expect(port.editing!()).toBe(true); // the blur grace of an explicit switch to Preview
    act(() => mq.set(true));
    expect(screen.queryByTestId('apps-mode-edit')).toBeNull();
    expect(port.editing!()).toBe(false);
  });

  it('Edit, then a phone directly: editing() is false (no grace)', async () => {
    const mq = phoneQuery();
    crew();
    render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} initialMode="edit" caps={{ apps: CAPS.apps }} />);
    await waitFor(() => expect(ports).toHaveLength(1));
    expect(ports[0]!.editing!()).toBe(true);
    act(() => mq.set(true));
    expect(ports[0]!.editing!()).toBe(false);
  });
});
