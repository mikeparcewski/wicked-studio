// Unit tests for src/api/interactive.ts — DES-MERGE-001 slice 2.
//
// Three concerns, one per AC:
//   1. Resolver: every URL derives from apiBase() and sits under
//      /api/v1/projects/<id>/interactive/ — no second origin, no port literal.
//   2. A 503 {code:"bridge_unavailable", hint} rejects with BridgeUnavailableError
//      carrying the hint verbatim (§7.12 — the UI must show something actionable).
//   3. Happy path: each wrapper hits the right method/path/body and returns the
//      declared shape, pinned against the bridge's real responses.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BridgeUnavailableError,
  DocDeletePartialError,
  ServiceHintError,
  createDoc,
  deleteDoc,
  docDeleteUrl,
  getLearnedTheme,
  getSources,
  listDemos,
  getVersions,
  interactiveDocUrl,
  interactiveUrl,
  listDocs,
  postEvent,
  postExport,
  postFork,
  requestRecord,
  requestThemeLearn,
} from '../src/api/interactive.js';
import { apiBase } from '../src/api/client.js';

/** Point jsdom's window.location at an arbitrary origin (as client.resolver does). */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

interface Call { url: string; init: RequestInit | undefined }

/** Stub fetch with a fixed response; returns the log of calls it received. */
function stubFetch(body: unknown, status = 200): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
  return calls;
}

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';
const DEMO = 'checkout-walkthrough';

/** Prod default: same-origin, no dev split. */
function prodOrigin(): void {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── 1. URL resolver ─────────────────────────────────────────────────────────

describe('interactive URL resolver', () => {
  /** One entry per wrapper: a plausible response body and the call to make. */
  const CASES: Array<[name: string, body: unknown, call: () => Promise<unknown>]> = [
    ['listDocs',   [],                                 () => listDocs(PROJECT)],
    ['getVersions', { head: 0, versions: [] },         () => getVersions(PROJECT, DOC)],
    ['createDoc',  { name: DOC, head: 0 },             () => createDoc(PROJECT, { name: DOC })],
    ['postFork',   { version: 1, parent: 0 },          () => postFork(PROJECT, DOC, 0)],
    ['postExport', { format: 'pdf', path: '/tmp/a.pdf', file: 'a.pdf', download: '/d/x/api/export/file/a.pdf' },
                                                       () => postExport(PROJECT, DOC, 1, 'pdf')],
    ['getSources', { sources: [] },                    () => getSources(PROJECT, DOC)],
    ['postEvent',  { ok: true, event_id: 'e1', correlation_id: 'c1' },
                                                       () => postEvent(PROJECT, { event_type: 'wicked.interactive.chat.posted' })],
    // The demo surface (corrected wire, DES-FEEDBACK-001 §7.4) — same mount, same rules.
    ['listDemos',  [],                                 () => listDemos(PROJECT)],
    ['requestRecord', { ok: true, event_id: 'e1', correlation_id: 'c1' },
                                                       () => requestRecord(PROJECT, DEMO)],
    // The theme surface (corrected wire, issue #65) — same mount, same rules.
    ['requestThemeLearn', { ok: true, event_id: 'e1', correlation_id: 'c1' },
       () => requestThemeLearn(PROJECT, DOC, { kind: 'url', url: 'https://acme.example' })],
    // The governed delete (studio#119) — crew-owned, but same resolver, same rules.
    ['deleteDoc', { name: DOC, kind: 'doc', retired: true, already_retired: false,
                    retired_at: '2026-09-01T10:00:00.000Z', head: 1, versions: 1,
                    ledger: { ok: true, removed_keys: [] } },
                                                       () => deleteDoc(PROJECT, DOC)],
  ];

  describe('prod (same-origin)', () => {
    beforeEach(prodOrigin);

    it.each(CASES)('%s: URL derives from apiBase() under the project-scoped mount', async (_name, body, call) => {
      const calls = stubFetch(body);
      await call();
      const url = calls[0]!.url;
      expect(url.startsWith(apiBase())).toBe(true);
      expect(url).toContain(`/api/v1/projects/${PROJECT}/interactive/`);
    });

    it.each(CASES)('%s: nothing beyond apiBase() carries an origin or a port', async (_name, body, call) => {
      const calls = stubFetch(body);
      await call();
      // Strip the resolver's own prefix; what remains must be a bare path —
      // no scheme, no `host:port`, and specifically never the bridge's 4400+.
      const tail = calls[0]!.url.slice(apiBase().length);
      expect(tail).not.toContain('://');
      expect(tail).not.toMatch(/:\d/);
      expect(calls[0]!.url).not.toContain('4400');
    });
  });

  it('dev split: VITE_API_HOST wins over window.location, for interactive too', async () => {
    vi.stubEnv('VITE_API_HOST', '127.0.0.1:7701');
    setLocation('http://127.0.0.1:4200/'); // the vite dev server origin
    const calls = stubFetch([]);
    await listDocs(PROJECT);
    expect(calls[0]!.url).toBe(
      `http://127.0.0.1:7701/api/v1/projects/${PROJECT}/interactive/api/docs`,
    );
    expect(calls[0]!.url).not.toContain(':4200');
    expect(calls[0]!.url).not.toContain('4400');
  });

  it('interactiveUrl resolves a bridge-relative download through the proxy', () => {
    prodOrigin();
    expect(interactiveUrl(PROJECT, '/d/q3-report/api/export/file/a.pdf')).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/d/q3-report/api/export/file/a.pdf`,
    );
    // Tolerates a path the bridge handed back without its leading slash.
    expect(interactiveUrl(PROJECT, 'doc/1')).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/doc/1`,
    );
  });

  it('project and doc ids are encoded, not interpolated raw', async () => {
    prodOrigin();
    const calls = stubFetch({ head: 0, versions: [] });
    await getVersions('proj/../evil', 'doc name');
    expect(calls[0]!.url).toContain('/projects/proj%2F..%2Fevil/interactive/');
    expect(calls[0]!.url).toContain('/d/doc%20name/api/versions');
  });
});

// ── 2. BridgeUnavailableError (§7.12) ───────────────────────────────────────

describe('BridgeUnavailableError', () => {
  beforeEach(prodOrigin);

  it('a 503 bridge_unavailable rejects with the typed error', async () => {
    stubFetch({ code: 'bridge_unavailable', hint: 'npm i -g wicked-interactive' }, 503);
    await expect(listDocs(PROJECT)).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it('carries the hint verbatim so the UI can render it', async () => {
    const hint = 'run: npm i -g wicked-interactive && wicked-crew restart';
    stubFetch({ code: 'bridge_unavailable', hint }, 503);
    const err = await listDocs(PROJECT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeUnavailableError);
    expect((err as BridgeUnavailableError).hint).toBe(hint);
    // The hint is reachable from `message` too, for bare error-boundary renders.
    expect((err as BridgeUnavailableError).message).toContain(hint);
  });

  it('applies to every wrapper, not just the read path', async () => {
    stubFetch({ code: 'bridge_unavailable', hint: 'install it' }, 503);
    await expect(postExport(PROJECT, DOC, 1, 'pdf')).rejects.toBeInstanceOf(BridgeUnavailableError);
  });

  it('a 503 without the bridge shape stays a generic Error', async () => {
    stubFetch({ error: 'service overloaded' }, 503);
    const err = await listDocs(PROJECT).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(BridgeUnavailableError);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('the daemon refused this — service overloaded');
  });

  it("surfaces the bridge's {error} message on ordinary failures", async () => {
    stubFetch({ error: 'doc already exists' }, 409);
    await expect(createDoc(PROJECT, { name: DOC })).rejects.toThrow('the daemon refused this — doc already exists');
  });
});

// ── 2b. ServiceHintError (§4.4, §3.3) ───────────────────────────────────────
//
// The typed 4xx that carries a NAMED fix — §4.4's lazy-dependency case (a PPTX
// export with python-pptx absent is a clean 400 with an install hint). slice 15's
// actionable-message path depends on `iFetch` producing THIS error from the wire,
// so the branch is pinned here directly rather than only through the mocked
// `postExport` in the export-wire tests.

describe('ServiceHintError', () => {
  beforeEach(prodOrigin);

  it('a 400 carrying {error, hint} rejects with the typed error', async () => {
    stubFetch({ error: 'pptx export unavailable', hint: 'pip install python-pptx' }, 400);
    await expect(postExport(PROJECT, DOC, 3, 'pptx')).rejects.toBeInstanceOf(ServiceHintError);
  });

  it('carries the install command verbatim and states the status in the message', async () => {
    const hint = 'pip install python-pptx (PPTX export needs it; HTML and PDF do not)';
    stubFetch({ error: 'pptx export unavailable: python-pptx is not importable', hint }, 400);
    const err = await postExport(PROJECT, DOC, 3, 'pptx').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceHintError);
    expect((err as ServiceHintError).hint).toBe(hint);
    // The message keeps the service's own reason, in the EC33 translated frame,
    // for a bare render; the status rides the typed field (slice X2).
    expect((err as ServiceHintError).message).toBe(
      'the daemon refused this — pptx export unavailable: python-pptx is not importable');
    expect((err as ServiceHintError).status).toBe(400);
  });

  it('trims the hint, and a whitespace-only hint is no hint — stays a generic Error', async () => {
    stubFetch({ error: 'nope', hint: '  pip install python-pptx  ' }, 400);
    const trimmed = await postExport(PROJECT, DOC, 3, 'pptx').catch((e: unknown) => e);
    expect((trimmed as ServiceHintError).hint).toBe('pip install python-pptx');

    stubFetch({ error: 'nope', hint: '   ' }, 400);
    const blank = await postExport(PROJECT, DOC, 3, 'pptx').catch((e: unknown) => e);
    expect(blank).not.toBeInstanceOf(ServiceHintError);
    expect(blank).toBeInstanceOf(Error);
    expect((blank as Error).message).toBe('the daemon refused this — nope');
  });

  it('the 503 bridge_unavailable branch wins even when a hint is present', async () => {
    // A hint does not downgrade the bridge-down signal: the UI must still route this
    // to the bridge-unavailable surface, not the per-export actionable one.
    stubFetch({ code: 'bridge_unavailable', hint: 'npm i -g wicked-interactive' }, 503);
    const err = await postExport(PROJECT, DOC, 3, 'pptx').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeUnavailableError);
    expect(err).not.toBeInstanceOf(ServiceHintError);
  });
});

// ── 3. Happy path — methods, bodies, shapes ─────────────────────────────────

describe('happy-path shapes', () => {
  beforeEach(prodOrigin);

  it('listDocs returns the registry array as-is', async () => {
    const docs = [{ name: DOC, kind: 'doc', head: 3, versions: 4, updated_at: '2026-08-17T00:00:00Z' }];
    stubFetch(docs);
    await expect(listDocs(PROJECT)).resolves.toEqual(docs);
  });

  it('getVersions returns the manifest (head + lineage)', async () => {
    const manifest = {
      head: 1,
      versions: [
        { version: 0, parent: null, feedback_file: null, html_file: '_v0.html', created_at: '2026-08-17T00:00:00Z' },
        { version: 1, parent: 0, feedback_file: '_v1.md', html_file: '_v1.html', created_at: '2026-08-17T01:00:00Z' },
      ],
    };
    stubFetch(manifest);
    await expect(getVersions(PROJECT, DOC)).resolves.toEqual(manifest);
  });

  it('createDoc POSTs the body as JSON and returns the created doc', async () => {
    const created = { name: DOC, head: 0, generating: true };
    const calls = stubFetch(created);
    const body = { name: DOC, kind: 'source' as const, source_paths: ['/data.csv'], brief: 'Q3' };
    await expect(createDoc(PROJECT, body)).resolves.toEqual(created);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBe(JSON.stringify(body));
    expect(calls[0]!.init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('postFork sends {from} — the bridge names it that, not "version"', async () => {
    const calls = stubFetch({ version: 4, parent: 3 });
    await expect(postFork(PROJECT, DOC, 3)).resolves.toEqual({ version: 4, parent: 3 });
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ from: 3 }));
  });

  it('postExport sends {version, format} and returns the download URL', async () => {
    const result = {
      format: 'pdf',
      path: '/home/u/docs/q3-report/_v3.pdf',
      file: '_v3.pdf',
      download: '/d/q3-report/api/export/file/_v3.pdf',
    };
    const calls = stubFetch(result);
    await expect(postExport(PROJECT, DOC, 3, 'pdf')).resolves.toEqual(result);
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ version: 3, format: 'pdf' }));
  });

  it('getSources unwraps {sources} into the entry list', async () => {
    const sources = [{
      path: '/home/u/data.csv', note: '', status: 'indexed',
      added_at: '2026-08-17T00:00:00Z', indexed_at: '2026-08-17T00:01:00Z',
    }];
    stubFetch({ sources });
    await expect(getSources(PROJECT, DOC)).resolves.toEqual(sources);
  });

  it('postEvent posts {event_type, payload} to the top-level bus route', async () => {
    const ack = { ok: true, event_id: 'evt-1', correlation_id: 'corr-1' };
    const calls = stubFetch(ack);
    await expect(postEvent(PROJECT, {
      event_type: 'wicked.interactive.review.requested',
      payload: { document_id: DOC, reviewers: ['a11y'] },
    })).resolves.toEqual(ack);
    // Top-level: the bus stream is shared across docs, so no /d/<id> prefix.
    expect(calls[0]!.url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/api/events`);
    expect(calls[0]!.init?.body).toBe(JSON.stringify({
      event_type: 'wicked.interactive.review.requested',
      payload: { document_id: DOC, reviewers: ['a11y'] },
    }));
  });

  it('postEvent defaults a missing payload to {} (the bridge requires the field)', async () => {
    const calls = stubFetch({ ok: true, event_id: 'e', correlation_id: 'c' });
    await postEvent(PROJECT, { event_type: 'wicked.interactive.status.requested' });
    expect(calls[0]!.init?.body).toBe(JSON.stringify({
      event_type: 'wicked.interactive.status.requested', payload: {},
    }));
  });

  // ── Demo wrappers (§4.5, slice 13) ────────────────────────────────────────

  it('listDemos narrows the ONE registry to kind:"demo" — no second route', async () => {
    const registry = [
      { name: 'q3-report', kind: 'doc', head: 1, versions: 1, updated_at: '2026-08-19T00:00:00Z' },
      { name: DEMO, kind: 'demo', head: 2, versions: 2, updated_at: '2026-08-18T00:00:00Z' },
    ];
    const calls = stubFetch(registry);
    await expect(listDemos(PROJECT)).resolves.toEqual([registry[1]]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/api/docs`);
  });

  // DES-FEEDBACK-001 §7.2/§7.4: `getDemoSpec` and `getLatestRecording` are GONE —
  // they spoke routes the bridge never served (the slice-13 fixture invented them).
  // The storyboard is the demo's version HTML now, addressed by `interactiveDocUrl`,
  // and the contract-check rig (e2e/interactive_wire_contract_test.py) pins the
  // invented routes as 404s against the REAL bridge.

  it('interactiveDocUrl builds the REAL storyboard route: /d/<id>/doc/<version>', () => {
    expect(interactiveDocUrl(PROJECT, DEMO, 2)).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/d/${DEMO}/doc/2`,
    );
  });

  it('requestRecord speaks the CORRECTED wire: demo.requested over POST /api/events', async () => {
    // The bridge has no /api/demo/record route; the real record trigger is the
    // UI-emittable `wicked.interactive.demo.requested` bus command (§7.2/§7.4).
    const calls = stubFetch({ ok: true, event_id: 'e1', correlation_id: 'c1' });
    await expect(requestRecord(PROJECT, DEMO)).resolves.toEqual({ queued: true });
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.url).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/api/events`,
    );
    expect(calls[0]!.init?.body).toBe(JSON.stringify({
      event_type: 'wicked.interactive.demo.requested',
      payload: { document_id: DEMO },
    }));
  });

  it('requestThemeLearn speaks the CORRECTED wire: theme.requested over POST /api/events (issue #65)', async () => {
    // The bridge has no learn endpoint and no theme registry. The real learn trigger is
    // the UI-emittable `wicked.interactive.theme.requested` bus command
    // (materializeThemeRequested), doc-scoped exactly like demo.requested; what it
    // produced is read back per-doc via getLearnedTheme (interactive#181, below).
    const calls = stubFetch({ ok: true, event_id: 'e1', correlation_id: 'c1' });
    await requestThemeLearn(PROJECT, DOC, { kind: 'url', url: 'https://acme.example' });
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.url).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/api/events`,
    );
    expect(calls[0]!.init?.body).toBe(JSON.stringify({
      event_type: 'wicked.interactive.theme.requested',
      payload: { document_id: DOC, url: 'https://acme.example' },
    }));
  });

  it('requestThemeLearn sends `path` (never `url`) for the local kinds — nothing uploads', async () => {
    const calls = stubFetch({ ok: true, event_id: 'e1', correlation_id: 'c1' });
    await requestThemeLearn(PROJECT, DOC, { kind: 'pdf', path: '/brand/guide.pdf' });
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.payload).toEqual({ document_id: DOC, path: '/brand/guide.pdf' });
    expect(body.payload).not.toHaveProperty('url');
  });

  // ── getLearnedTheme — the interactive#181 readback ──────────────────────────

  it('getLearnedTheme GETs the per-doc readback route and returns the body verbatim', async () => {
    const learned = {
      document_id: DOC,
      learned_at: '2026-08-21T12:00:00.000Z',
      tokens: {
        name: 'acme-brand',
        colors: { background: '#f8fafc', primary: '#0a2a5e' },
        fonts: { heading: 'Georgia', body: 'Georgia', mono: 'Menlo' },
      },
    };
    const calls = stubFetch(learned);
    const result = await getLearnedTheme(PROJECT, DOC);
    expect(calls[0]!.init?.method ?? 'GET').toBe('GET');
    expect(calls[0]!.url).toBe(
      `${apiBase()}/projects/${PROJECT}/interactive/d/${DOC}/api/theme/learned`,
    );
    expect(result).toEqual(learned); // tokens are the learned.theme.json VERBATIM
  });

  it("getLearnedTheme resolves null on the route's own 404 {error:'no learned theme'}", async () => {
    // The 404-with-JSON body is the not-learned-yet signal (also the corrupt-file
    // degradation) — the poll's "keep waiting", never an exception.
    stubFetch({ error: 'no learned theme' }, 404);
    await expect(getLearnedTheme(PROJECT, DOC)).resolves.toBeNull();
  });

  it('getLearnedTheme still throws on any OTHER failure — unknown doc, dead bridge', async () => {
    // An unknown doc is an express-default 404 (no JSON error to match) — a real
    // error, thrown in the EC33 translated frame carrying the service's sentence.
    stubFetch('Cannot GET /d/absent/api/theme/learned', 404);
    await expect(getLearnedTheme(PROJECT, 'absent')).rejects.toThrow(
      /the daemon refused this — .*Cannot GET \/d\/absent\/api\/theme\/learned/);
    // A dead bridge stays the typed 503, exactly as every other wrapper.
    stubFetch({ code: 'bridge_unavailable', hint: 'npm i -g wicked-interactive' }, 503);
    await expect(getLearnedTheme(PROJECT, DOC)).rejects.toBeInstanceOf(BridgeUnavailableError);
  });
});

// ── deleteDoc — the governed delete, ADOPTED (studio#119) ─────────────────────
//
// For two releases this block was the absence guard ("no invented unmake wire"),
// and its own instructions said what to do the day the wire landed: adopt the
// route, and move this guard and section 8 of e2e/interactive_wire_contract_test.py
// together. Both moved in the same change: the bridge serves the retire route
// (interactive#189) and crew serves the GOVERNED delete on top of it (crew#338),
// which is the one studio speaks — retire + crew's handoff-ledger sweep in one
// call, loud on divergence.
describe('deleteDoc — the governed delete route (studio#119 / crew#338)', () => {
  beforeEach(prodOrigin);

  const RETIRED = {
    name: DOC,
    kind: 'doc',
    retired: true,
    already_retired: false,
    retired_at: '2026-09-01T10:00:00.000Z',
    head: 3,
    versions: 3,
    event_id: 41,
    ledger: { ok: true, removed_keys: [DOC, `${DOC}:v3`] },
  };

  it('speaks DELETE against the CREW route — /interactive/docs/:doc, NOT the proxy registry path', async () => {
    const calls = stubFetch(RETIRED);
    await deleteDoc(PROJECT, DOC);
    expect(calls[0]!.init?.method).toBe('DELETE');
    // The governed route is crew-owned: one static segment more specific than the
    // proxy's wildcard. A raw DELETE through the proxy path (`/interactive/api/docs/…`)
    // would retire the doc WITHOUT crew's ledger sweep — the exact ghost studio#119
    // exists to kill — so the URL is pinned exactly, not by substring.
    expect(calls[0]!.url).toBe(`${apiBase()}/projects/${PROJECT}/interactive/docs/${DOC}`);
    expect(calls[0]!.url).not.toContain('/interactive/api/');
    // No request body on the wire (and so no Content-Type invented for one).
    expect(calls[0]!.init?.body).toBeUndefined();
  });

  it('percent-encodes both path segments', async () => {
    stubFetch({ error: 'unknown doc', name: 'a/b', ledger: { ok: true, removed_keys: [] } }, 404);
    await deleteDoc('p one', 'a/b');
    expect(docDeleteUrl('p one', 'a/b')).toContain('/projects/p%20one/interactive/docs/a%2Fb');
  });

  it('200: resolves with the retire body VERBATIM — both halves named', async () => {
    stubFetch(RETIRED);
    await expect(deleteDoc(PROJECT, DOC)).resolves.toEqual(RETIRED);
  });

  it('200 repeat: the idempotent already_retired answer resolves the same way', async () => {
    const repeat = { ...RETIRED, already_retired: true, ledger: { ok: true, removed_keys: [] } };
    delete (repeat as Record<string, unknown>)['event_id'];
    stubFetch(repeat);
    const result = await deleteDoc(PROJECT, DOC);
    expect(result).toEqual(repeat);
    expect((result as typeof RETIRED).already_retired).toBe(true);
  });

  it("404 with the retire wire's own body is the GHOST cleanup — a resolution, not an error", async () => {
    // A hand-rm'd workspace: unknown to interactive, but crew still swept its
    // ledgers (the removed_keys say what fell). The doc is equally gone.
    stubFetch({ error: 'unknown doc', name: DOC, ledger: { ok: true, removed_keys: [DOC] } }, 404);
    await expect(deleteDoc(PROJECT, DOC)).resolves.toEqual({
      ghost: true, name: DOC, ledger: { ok: true, removed_keys: [DOC] },
    });
  });

  it('404 unknown PROJECT (no ledger in the body) stays a thrown refusal', async () => {
    stubFetch({ error: `Project ${PROJECT} not found` }, 404);
    await expect(deleteDoc(PROJECT, DOC)).rejects.toMatchObject({
      name: 'ApiError', status: 404, wire: `Project ${PROJECT} not found`,
    });
  });

  it('409 build-in-flight: ApiError carrying the bridge refusal verbatim in .wire', async () => {
    stubFetch({ error: 'doc has a build in flight — wait for it to settle', document_id: DOC, active: true }, 409);
    await expect(deleteDoc(PROJECT, DOC)).rejects.toMatchObject({
      name: 'ApiError', status: 409, wire: 'doc has a build in flight — wait for it to settle',
    });
  });

  it('500 PARTIAL throws the TYPED DocDeletePartialError — verbatim wire + the ledger report', async () => {
    // The one state needing operator attention: interactive retired, a ledger
    // sweep failed. The surface must render the wire's sentence VERBATIM and
    // keep the retry armed, so the error carries both typed.
    const wire = `partial delete: wicked-interactive retired '${DOC}' but crew could not drop `
      + 'every handoff-ledger row. Re-issue this DELETE to retry the sweep.';
    const ledger = { ok: false, removed_keys: [DOC], errors: [{ ledger: 'draft', error: 'EACCES' }] };
    stubFetch({ error: wire, name: DOC, interactive: RETIRED, ledger }, 500);
    const err = await deleteDoc(PROJECT, DOC).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DocDeletePartialError);
    expect((err as DocDeletePartialError).wire).toBe(wire);
    expect((err as DocDeletePartialError).ledger).toEqual(ledger);
  });

  it('502 not-retired (nothing diverged) throws ApiError with the wire sentence', async () => {
    stubFetch({
      error: `wicked-interactive did not retire '${DOC}' (HTTP 500)`,
      name: DOC,
      upstream_status: 500,
      ledger: { ok: false, removed_keys: [], skipped: true },
    }, 502);
    await expect(deleteDoc(PROJECT, DOC)).rejects.toMatchObject({ name: 'ApiError', status: 502 });
  });

  it('503 bridge_unavailable stays the typed error with its runnable hint', async () => {
    stubFetch({ code: 'bridge_unavailable', hint: 'npm i -g wicked-interactive' }, 503);
    const err = await deleteDoc(PROJECT, DOC).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BridgeUnavailableError);
    expect((err as BridgeUnavailableError).hint).toBe('npm i -g wicked-interactive');
  });
});
