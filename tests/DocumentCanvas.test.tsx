// Unit tests for the Document-mode canvas — DES-MERGE-001 §6.3 slice 8.
//
// Three concerns, one per AC:
//   1. Canvas src derivation: origin-relative (never a second origin, never a port
//      literal) and version-addressed, through the slice-2 client's `apiBase()`.
//   2. A 503 {code:"bridge_unavailable", hint} surfaces the hint VERBATIM, with its
//      named command intact (§7.12 / §3.3 — actionable, not a bare failure).
//   3. The picker orders most-recent first and navigates into /p/<id>/document/<docId>;
//      empty invites creation rather than rendering blank.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCanvas } from '../src/components/DocumentCanvas.js';
import type { DocSummary, VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-abc-123';
const DOC = 'q3-report';

/** Point jsdom's window.location at an arbitrary origin (as client.resolver does). */
function setLocation(url: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

/** Prod default: same-origin, no dev split — the posture §5.3's frame relies on. */
function prodOrigin(): void {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
}

type Reply = { status?: number; body: unknown };

/** Route stubbed fetch by URL substring; unmatched URLs are a loud test failure. */
function stubFetch(routes: Record<string, Reply>): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    seen.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) return Promise.reject(new Error(`unrouted fetch: ${url}`));
    const { status = 200, body } = routes[key];
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: () => Promise.resolve(JSON.stringify(body)),
      json: () => Promise.resolve(body),
    });
  }));
  return seen;
}

const MANIFEST: VersionManifest = {
  head: 3,
  versions: [
    { version: 1, parent: null, feedback_file: null, html_file: 'v1.html', created_at: '2026-08-16T09:00:00Z' },
    { version: 2, parent: 1, feedback_file: 'f2.json', html_file: 'v2.html', created_at: '2026-08-17T09:00:00Z' },
    { version: 3, parent: 2, feedback_file: null, html_file: 'v3.html', created_at: '2026-08-18T09:00:00Z' },
  ],
};

function doc(name: string, updated_at: string | null, head = 1): DocSummary {
  return { name, kind: 'doc', head, versions: head, updated_at };
}

const BRIDGE_DOWN: Reply = {
  status: 503,
  body: {
    code: 'bridge_unavailable',
    hint: 'run `npm i -g wicked-interactive` then retry — the bridge could not be started',
  },
};

beforeEach(prodOrigin);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('DocumentCanvas — the frame (§5.3, §6.3)', () => {
  it('AC: derives the src from apiBase(), on the PAGE ORIGIN, under the project-scoped proxy', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    const src = frame.getAttribute('src') ?? '';
    expect(src).toBe(`http://127.0.0.1:7788/api/v1/projects/${PROJECT}/interactive/d/${DOC}/doc/3`);
    // The property the overlay (slice 11+12) depends on: one origin, the page's own.
    expect(new URL(src).origin).toBe(window.location.origin);
    // No bridge port literal ever reaches the bundle (§5.3, slice 1's grep AC).
    expect(src).not.toMatch(/44\d\d/);
  });

  it('AC: the src is VERSION-ADDRESSED — it pins the manifest head, not a bare /doc', async () => {
    stubFetch({ '/api/versions': { body: { ...MANIFEST, head: 2 } } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    expect(frame.getAttribute('src')).toMatch(/\/doc\/2$/);
    expect(frame).toHaveAttribute('data-version', '2');
  });

  it('percent-encodes a doc id that would otherwise escape its path segment', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId="a/b c" navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    expect(frame.getAttribute('src')).toContain('/d/a%2Fb%20c/doc/3');
  });

  it('AC: carries the §5.5 status-quo sandbox — allow-scripts + allow-same-origin', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin');
  });

  it('§3.3: while the doc loads the surface NAMES it — never a bare spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})));
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const loading = await screen.findByTestId('doc-canvas-loading');
    expect(loading).toHaveTextContent(DOC);
    expect(loading.textContent).not.toMatch(/^\s*(working|loading)…?\s*$/i);
  });
});

describe('DocumentCanvas — bridge_unavailable (§7.12, §3.3)', () => {
  it('AC: surfaces the 503 hint VERBATIM, with its named command intact', async () => {
    stubFetch({ '/api/versions': BRIDGE_DOWN });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const hint = await screen.findByTestId('doc-bridge-hint');
    const expected = (BRIDGE_DOWN.body as { hint: string }).hint;
    expect(hint.textContent).toContain(expected);
    expect(hint.textContent).toContain('npm i -g wicked-interactive');
    // The failure names its subject and offers the next action, per §3.3.
    expect(screen.getByTestId('doc-canvas-error')).toHaveTextContent(DOC);
    expect(screen.getByTestId('doc-canvas-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-canvas')).toBeNull();
  });

  it('surfaces the same hint from the PICKER path, not only the frame', async () => {
    stubFetch({ '/api/docs': BRIDGE_DOWN });
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    const hint = await screen.findByTestId('doc-bridge-hint');
    expect(hint.textContent).toContain('npm i -g wicked-interactive');
  });

  it('a non-bridge failure still states what happened and offers Retry', async () => {
    stubFetch({ '/api/versions': { status: 500, body: { error: 'versions.json is corrupt' } } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    expect(await screen.findByTestId('doc-error-detail')).toHaveTextContent('versions.json is corrupt');
    expect(screen.getByTestId('doc-canvas-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-bridge-hint')).toBeNull();
  });

  it('Retry re-issues the load, and a now-healthy bridge renders the frame', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(() => {
      attempt += 1;
      const reply: Reply = attempt === 1 ? BRIDGE_DOWN : { body: MANIFEST };
      return Promise.resolve({
        ok: (reply.status ?? 200) < 300,
        status: reply.status ?? 200,
        statusText: String(reply.status ?? 200),
        text: () => Promise.resolve(JSON.stringify(reply.body)),
        json: () => Promise.resolve(reply.body),
      });
    }));
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    await userEvent.click(await screen.findByTestId('doc-canvas-retry'));
    expect(await screen.findByTestId('doc-canvas')).toBeInTheDocument();
    expect(attempt).toBe(2);
  });
});

describe('DocumentCanvas — the picker (§6.3: no :docId in the route)', () => {
  const DOCS: DocSummary[] = [
    doc('stale-brief', '2026-08-10T08:00:00Z'),
    doc('launch-deck', '2026-08-18T11:30:00Z', 4),
    doc('never-touched', null),
    doc('q3-report', '2026-08-17T16:00:00Z', 2),
  ];

  it('AC: lists the project’s docs MOST-RECENT FIRST (a null updated_at sinks)', async () => {
    stubFetch({ '/api/docs': { body: DOCS } });
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    await screen.findByTestId('doc-picker');
    const rows = screen.getAllByTestId('doc-picker-row');
    expect(rows.map((r) => r.getAttribute('data-doc-id')))
      .toEqual(['launch-deck', 'q3-report', 'stale-brief', 'never-touched']);
  });

  it('AC: selecting a doc navigates to /p/<id>/document/<docId>', async () => {
    const navigate = vi.fn();
    stubFetch({ '/api/docs': { body: DOCS } });
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={navigate} />);

    await screen.findByTestId('doc-picker');
    await userEvent.click(screen.getAllByTestId('doc-picker-row')[0]);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/launch-deck`);
  });

  it('encodes both segments so an odd project or doc id still round-trips', async () => {
    const navigate = vi.fn();
    stubFetch({ '/api/docs': { body: [doc('a/b', '2026-08-18T00:00:00Z')] } });
    render(<DocumentCanvas projectId="p 1" docId={null} navigate={navigate} />);

    await screen.findByTestId('doc-picker');
    await userEvent.click(screen.getByTestId('doc-picker-row'));
    expect(navigate).toHaveBeenCalledWith('/p/p%201/document/a%2Fb');
  });

  it('§1.4: an empty project INVITES creation rather than rendering blank', async () => {
    stubFetch({ '/api/docs': { body: [] } });
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    const empty = await screen.findByTestId('doc-picker-empty');
    expect(empty).toHaveTextContent(/no documents/i);
    // Informative, not blank: it names where a document comes from (the thread).
    expect(empty).toHaveTextContent(/thread/i);
    expect(screen.queryByTestId('doc-picker')).toBeNull();
  });

  it('reads the doc registry through the project-scoped proxy path (§7.2)', async () => {
    const seen = stubFetch({ '/api/docs': { body: [] } });
    render(<DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}} />);

    await waitFor(() => expect(seen.length).toBe(1));
    expect(seen[0]).toBe(`http://127.0.0.1:7788/api/v1/projects/${PROJECT}/interactive/api/docs`);
  });
});
