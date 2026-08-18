// Learn-a-theme + sources attach, at the WIRE (DES-MERGE-001 §4.6, §4.9, §6.4 slice 16).
//
// These tests drive the REAL client (`src/api/interactive.ts`) against a stubbed `fetch`,
// not a mocked module, because two of the four ACs are claims about what does and does not
// leave the page — and a mocked client cannot prove either one:
//
//   - nothing uploads: every submission body is a JSON string carrying a PATH. No
//     `FormData`, no `File`, no `Blob`, no `multipart/*` content type (§4.6, §4.9).
//   - the SPA never fetches the target: a learn-from-URL submission goes to the bridge
//     proxy and only there, so the SSRF guard (§4.6) is the only thing that ever resolves
//     that address. When it refuses, its reason reaches the transcript verbatim.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  attachSourceFromThread, learnBody, learnFix, learnReady, learnThemeFromThread,
  serviceReason, sourceStatusLine,
} from '../src/interactive/themeWire.js';
import { listThemes } from '../src/api/interactive.js';
import { apiBase } from '../src/api/client.js';
import { threadKey, useDocThreadStore, type DocMsg } from '../src/store/docThread.js';

const PROJECT = 'proj-abc';
const DOC = 'q3-report';
const KEY = threadKey(PROJECT, DOC);

/** The metadata endpoint §6.4's AC names. The guard is server-side; this address must
 *  never appear in a request the SPA itself makes. */
const METADATA = 'http://169.254.169.254/';

interface Call { url: string; init: RequestInit | undefined }

/** Stub fetch with one queued response per call; returns the log it received. */
function stubFetch(responses: Array<{ body: unknown; status?: number }>): Call[] {
  const calls: Call[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift() ?? { body: {}, status: 200 };
    const status = next.status ?? 200;
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(next.body)),
      json: () => Promise.resolve(next.body),
    });
  }));
  return calls;
}

function thread(): DocMsg[] {
  return useDocThreadStore.getState().messages[KEY] ?? [];
}

/** Every message body, flattened — what a human scrolling the transcript would read. */
function transcript(): string {
  return thread().map((m) => ('text' in m ? m.text : '')).join('\n');
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', {
    value: new URL('http://127.0.0.1:7788/'), writable: true, configurable: true,
  });
  useDocThreadStore.setState({ messages: {}, genState: {}, anchor: {}, landed: {} });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ── AC: submission shapes, per kind ──────────────────────────────────────────

describe('submission shape per kind (url / pdf / image)', () => {
  it('a URL travels as `url`; a PDF and an image travel as `path`', () => {
    expect(learnBody('url', ' https://stripe.com ')).toEqual({ kind: 'url', url: 'https://stripe.com' });
    expect(learnBody('pdf', ' /brand/guide.pdf ')).toEqual({ kind: 'pdf', path: '/brand/guide.pdf' });
    expect(learnBody('image', '/shots/home.png')).toEqual({ kind: 'image', path: '/shots/home.png' });
  });

  it('a local kind sends NO url field, so the service never treats a path as fetchable', () => {
    for (const kind of ['pdf', 'image'] as const) {
      expect(learnBody(kind, '/x.pdf')).not.toHaveProperty('url');
    }
    expect(learnBody('url', 'https://x.dev')).not.toHaveProperty('path');
  });

  it('readiness is a SHAPE check only — an address the guard will refuse is submittable', () => {
    // Deliberate (§4.6): pre-rejecting here would answer with the client's opinion
    // instead of the guard's stated reason, and the two would drift.
    expect(learnReady('url', METADATA)).toBe(true);
    expect(learnReady('url', 'stripe.com')).toBe(false);   // not http(s) — a typo, not a policy
    expect(learnReady('pdf', '   ')).toBe(false);
    expect(learnReady('image', '/shots/home.png')).toBe(true);
  });

  it.each(['url', 'pdf', 'image'] as const)(
    '%s: POSTs the kind to the proxied learn endpoint as a JSON body — never a form',
    async (kind) => {
      const calls = stubFetch([{ body: { theme_id: 't1', status: 'queued' } }]);
      const value = kind === 'url' ? 'https://stripe.com' : '/brand/guide.pdf';
      await learnThemeFromThread({ projectId: PROJECT, docId: DOC, kind, value });

      expect(calls).toHaveLength(1);
      const { url, init } = calls[0]!;
      expect(url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/api/theme/learn`);
      expect(init?.method).toBe('POST');
      expect(typeof init?.body).toBe('string');
      expect(JSON.parse(init?.body as string)).toEqual(learnBody(kind, value));
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    },
  );

  it('the submission is a MESSAGE, and the learning narrates informatively (§2.3, §3.3)', async () => {
    stubFetch([{ body: { theme_id: 'stripe', status: 'queued' } }]);
    await learnThemeFromThread({
      projectId: PROJECT, docId: DOC, kind: 'url', value: 'https://stripe.com',
    });
    expect(thread()[0]).toMatchObject({ kind: 'user', text: 'Learn a theme from https://stripe.com.' });
    const narration = thread().filter((m) => m.kind === 'narration');
    expect(narration.length).toBeGreaterThanOrEqual(2);
    // Informative means it names its subject AND what is happening to it — never bare.
    expect(narration[0]!.text).toContain('https://stripe.com');
    expect(narration[0]!.text).not.toBe('Working…');
  });

  it('the local kinds SAY the no-upload guarantee, as §4.6 requires of the UI', async () => {
    stubFetch([{ body: { theme_id: 't', status: 'queued' } }]);
    await learnThemeFromThread({
      projectId: PROJECT, docId: DOC, kind: 'pdf', value: '/brand/guide.pdf',
    });
    expect(transcript()).toContain('not uploaded');
  });

  it("the bridge's own progress line wins over ours when it wrote one", async () => {
    stubFetch([{ body: { theme_id: 't', status: 'queued', message: 'Reading the palette from 12 captured pages.' } }]);
    await learnThemeFromThread({
      projectId: PROJECT, docId: DOC, kind: 'url', value: 'https://stripe.com',
    });
    expect(transcript()).toContain('Reading the palette from 12 captured pages.');
  });
});

// ── AC: the SSRF refusal is the SERVICE's, surfaced verbatim ─────────────────

describe('SSRF rejection surfacing (§4.6 — the guard stays server-side)', () => {
  const REASON = 'refused: 169.254.169.254 resolves to a link-local address';

  it('shows the reason VERBATIM and makes no request to the address itself', async () => {
    const calls = stubFetch([{ body: { error: REASON }, status: 400 }]);
    const outcome = await learnThemeFromThread({
      projectId: PROJECT, docId: DOC, kind: 'url', value: METADATA,
    });

    expect(outcome).toEqual({ ok: false, reason: REASON });
    // ONE request, to the bridge proxy — never to the target. This is the unit-level
    // twin of the Playwright `page.on('request')` assertion.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/api/theme/learn`);
    for (const call of calls) expect(call.url).not.toContain('169.254.169.254');

    const actionable = thread().find((m) => m.kind === 'actionable');
    expect(actionable).toBeDefined();
    // Verbatim: the guard's own sentence, not a paraphrase and not an HTTP status.
    expect((actionable as Extract<DocMsg, { kind: 'actionable' }>).text).toContain(REASON);
    expect((actionable as Extract<DocMsg, { kind: 'actionable' }>).text).not.toContain('API 400');
  });

  it('a refusal still carries a next action — §3.3 bans an error without one', async () => {
    stubFetch([{ body: { error: REASON }, status: 400 }]);
    await learnThemeFromThread({ projectId: PROJECT, docId: DOC, kind: 'url', value: METADATA });
    const actionable = thread().find((m) => m.kind === 'actionable') as Extract<DocMsg, { kind: 'actionable' }>;
    expect(actionable.hint.trim()).not.toBe('');
    expect(actionable.hint).toContain('PDF or image');
  });

  it("the service's own named fix wins over ours whenever it gave one", async () => {
    const hint = 'set WI_ALLOW_PRIVATE_THEME_HOSTS=1 to allow this host';
    stubFetch([{ body: { error: REASON, hint }, status: 400 }]);
    await learnThemeFromThread({ projectId: PROJECT, docId: DOC, kind: 'url', value: METADATA });
    const actionable = thread().find((m) => m.kind === 'actionable') as Extract<DocMsg, { kind: 'actionable' }>;
    expect(actionable.hint).toBe(hint);
  });

  it('the ask stays in the transcript after a refusal — a rejected theme is a record', async () => {
    stubFetch([{ body: { error: REASON }, status: 400 }]);
    await learnThemeFromThread({ projectId: PROJECT, docId: DOC, kind: 'url', value: METADATA });
    expect(thread()[0]).toMatchObject({ kind: 'user' });
    expect(transcript()).toContain(METADATA);
  });

  it('serviceReason unwraps the client framing; learnFix always names something to do', () => {
    expect(serviceReason(new Error('API 400: not an http(s) URL'))).toBe('not an http(s) URL');
    expect(serviceReason(new Error('connection refused'))).toBe('connection refused');
    expect(learnFix('pdf', new Error('boom')).trim()).not.toBe('');
  });
});

// ── AC: sources attach uploads NOTHING ───────────────────────────────────────

describe('sources attach (§4.9 — the service reads it in place)', () => {
  const PATH = '/Users/me/finance/q3';

  it('sends the PATH as JSON: no FormData, no File, no multipart body', async () => {
    const calls = stubFetch([{ body: { path: PATH, note: '', status: 'indexing', added_at: 'now', indexed_at: null } }]);
    const outcome = await attachSourceFromThread({ projectId: PROJECT, docId: DOC, path: PATH });

    expect(outcome.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/d/${DOC}/api/sources`);
    expect(init?.method).toBe('POST');
    // The whole of the no-upload guarantee, at the only place it can be broken.
    expect(init?.body).toBeTypeOf('string');
    expect(init?.body).not.toBeInstanceOf(FormData);
    expect(JSON.parse(init?.body as string)).toEqual({ path: PATH });
    const ctype = (init?.headers as Record<string, string>)['Content-Type'];
    expect(ctype).toBe('application/json');
    expect(ctype).not.toContain('multipart');
    // The body carries the path and nothing else — no bytes, no file name list.
    expect((init?.body as string).length).toBeLessThan(PATH.length + 32);
  });

  it('the attach is a message, and says where the reading happens (§2.3, §4.9)', async () => {
    stubFetch([{ body: { path: PATH, note: '', status: 'indexed', added_at: 'now', indexed_at: 'now' } }]);
    await attachSourceFromThread({ projectId: PROJECT, docId: DOC, path: PATH });
    expect(thread()[0]).toMatchObject({ kind: 'user', text: `Use ${PATH} as reference.` });
    expect(transcript()).toContain('Nothing is uploaded.');
    expect(transcript()).toContain('is indexed');
  });

  it('a source the service could not read is ACTIONABLE and does not claim context', async () => {
    stubFetch([{ body: { path: PATH, note: '', status: 'error', added_at: 'now', indexed_at: null } }]);
    const outcome = await attachSourceFromThread({ projectId: PROJECT, docId: DOC, path: PATH });
    expect(outcome.ok).toBe(false);
    const actionable = thread().find((m) => m.kind === 'actionable') as Extract<DocMsg, { kind: 'actionable' }>;
    expect(actionable.text).toContain(PATH);
    expect(actionable.hint).toContain('attach it again');
  });

  it('a refused attach surfaces the service reason verbatim', async () => {
    stubFetch([{ body: { error: 'path is outside the project root' }, status: 400 }]);
    const outcome = await attachSourceFromThread({ projectId: PROJECT, docId: DOC, path: '/etc' });
    expect(outcome).toEqual({ ok: false, reason: 'path is outside the project root' });
    expect(transcript()).toContain('path is outside the project root');
  });

  it('every status line names its subject (§3.3)', () => {
    const base = { path: PATH, note: '', added_at: 'now', indexed_at: null };
    for (const status of ['pending', 'indexing', 'indexed'] as const) {
      expect(sourceStatusLine({ ...base, status })).toContain(PATH);
    }
  });
});

// ── The library, as the bridge may spell it ──────────────────────────────────

describe('theme library', () => {
  it('reads a bare array and a `{themes}` envelope the same way', async () => {
    const rows = [{ name: 'stripe', source: 'url' as const, learned_at: 'now' }];
    stubFetch([{ body: rows }]);
    await expect(listThemes(PROJECT)).resolves.toEqual(rows);
    stubFetch([{ body: { themes: rows } }]);
    await expect(listThemes(PROJECT)).resolves.toEqual(rows);
  });

  it('is fetched through the project-scoped proxy mount — no second origin', async () => {
    const calls = stubFetch([{ body: [] }]);
    await listThemes(PROJECT);
    expect(calls[0]!.url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/api/themes`);
  });
});
