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
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocumentCanvas } from '../src/components/DocumentCanvas.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
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
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (hit === undefined) return Promise.reject(new Error(`unrouted fetch: ${url}`));
    const { status = 200, body } = hit[1];
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

  // ── REGRESSION PIN (§5.5, §7.3) ────────────────────────────────────────────
  // Agent-authored HTML is influenced by untrusted input. With `allow-same-origin` it
  // executes on the app's origin with the user's ambient authority — it could read
  // localStorage and call /api/v1. §7.3 merged slices 11+12 precisely so that the
  // overlay could never be the reason someone put this back "just for now". If this
  // test ever needs changing, the change is a security decision, not a refactor.
  it('AC: the frame is FULLY sandboxed — allow-scripts, and never allow-same-origin', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox.split(/\s+/)).not.toContain('allow-same-origin');
    // Neither by any other spelling of "give the document the app's authority".
    expect(sandbox).not.toMatch(/allow-(same-origin|top-navigation|popups-to-escape-sandbox)/);
  });

  it('§3.3: while the doc loads the surface NAMES it — never a bare spinner', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => {})));
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    const loading = await screen.findByTestId('doc-canvas-loading');
    expect(loading).toHaveTextContent(DOC);
    expect(loading.textContent).not.toMatch(/^\s*(working|loading)…?\s*$/i);
  });
});

describe('DocumentCanvas — the routed version drives the frame (§4.2, slice 9)', () => {
  it('AC: with ?v=1 routed, the frame src is the v1 URL and the strip highlights v1', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={1} navigate={() => {}} />);

    const frame = await screen.findByTestId('doc-canvas');
    expect(frame.getAttribute('src')).toMatch(/\/doc\/1$/);
    expect(frame).toHaveAttribute('data-version', '1');
    expect(screen.getAllByTestId('version-entry')[0]).toHaveAttribute('data-selected', 'true');
  });

  it('no routed version means the manifest HEAD — the strip renders either way', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={null} navigate={() => {}} />);

    expect((await screen.findByTestId('doc-canvas')).getAttribute('src')).toMatch(/\/doc\/3$/);
    expect(screen.getAllByTestId('version-entry')).toHaveLength(3);
  });

  it('a ?v the manifest does not know resolves to the head, not a framed 404', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={99} navigate={() => {}} />);

    expect((await screen.findByTestId('doc-canvas')).getAttribute('src')).toMatch(/\/doc\/3$/);
  });

  it('selecting a version in the strip navigates — the frame follows the ROUTE', async () => {
    const navigate = vi.fn();
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={3} navigate={navigate} />);

    await screen.findByTestId('doc-canvas');
    await userEvent.click(screen.getAllByTestId('version-select')[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=1`);
  });

  it('a fork (now in the panel’s Versions tab) re-reads the manifest and routes to the version the SERVICE reported', async () => {
    // RE-SCOPED (doc-feedback round): the band's Fork chiclet is gone — the
    // fork gesture LIVES in the right panel's Versions tab (§0: protected
    // gestures move, they never silently die).
    const forked = {
      head: 4,
      versions: [...MANIFEST.versions, {
        version: 4, parent: 1, feedback_file: null, html_file: 'v4.html',
        created_at: '2026-08-18T10:00:00Z',
      }],
    };
    let reads = 0;
    const navigate = vi.fn();
    stubFetch({
      '/api/versions': { get body() { reads += 1; return reads === 1 ? MANIFEST : forked; } },
      '/api/fork': { body: { version: 4, parent: 1 } },
    });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} version={null} navigate={navigate} />);

    await screen.findByTestId('doc-canvas');
    // The rail's Versions button expands the panel straight onto the tab.
    await userEvent.click(screen.getByTestId('doc-panel-rail')
      .querySelector('[data-testid="panel-rail-tab"][data-tab="versions"]') as HTMLElement);
    // Detail rows are NEWEST FIRST; v1's row is the last. Fork from v1.
    const rows = screen.getAllByTestId('version-detail');
    expect(rows.map((r) => r.getAttribute('data-version'))).toEqual(['3', '2', '1']);
    await userEvent.click(rows[2]!.querySelector('[data-testid="version-fork"]') as HTMLElement);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/document/${DOC}?v=4`));
    // The manifest is re-read rather than patched locally (§4.2: the service is authority).
    await waitFor(() => expect(screen.getAllByTestId('version-entry')).toHaveLength(4));
    // The band pill names the branch in its title; the DETAIL row states it.
    await waitFor(() => expect(
      screen.getAllByTestId('version-detail-lineage').map((l) => l.textContent),
    ).toContain('branched from v1'));
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
    // Load 1 failed, load 2 (the retry) answered the manifest — and the healthy
    // frame's own HTML read (the docfb2 instrument fetch) is load 3.
    expect(attempt).toBe(3);
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
    await userEvent.click(screen.getAllByTestId('doc-picker-row')[0]!);
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

// ── DES-UXFIX-001 §2.6 (slice 6) → RE-SCOPED by the doc-feedback round: the
//    right panel replaced the drawer, the band is versions-only ───────────────

describe('DocumentCanvas — canvas-first: right panel + slim strip (doc-feedback round)', () => {
  const thread = <aside data-testid="fake-thread">the thread pane</aside>;

  beforeEach(() => {
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {} });
  });

  it('AC: with a doc open the panel is COLLAPSED to its rail by default and the strip lives INSIDE the canvas container', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(
      <DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}}>
        {thread}
      </DocumentCanvas>,
    );

    await screen.findByTestId('doc-canvas');
    // The canvas owns the viewport — the panel is a RAIL on first visit, and
    // the rail is the panel's OWN expand affordance (no strip toggle).
    expect(screen.queryByTestId('doc-panel')).toBeNull();
    expect(screen.queryByTestId('fake-thread')).toBeNull();
    expect(screen.getByTestId('doc-panel-rail')).toBeInTheDocument();
    expect(screen.getByTestId('panel-expand')).toBeInTheDocument();
    // The strip floats over the canvas's bottom edge, inside its container.
    const container = screen.getByTestId('document-canvas');
    const strip = screen.getByTestId('version-strip');
    expect(container.contains(strip)).toBe(true);
    expect(container.contains(screen.getByTestId('doc-canvas'))).toBe(true);
  });

  it('AC: the panel expands from its OWN rail (canvas reflows to a flex sibling) and collapses again', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(
      <DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}}>
        {thread}
      </DocumentCanvas>,
    );
    await screen.findByTestId('doc-canvas');

    await userEvent.click(screen.getByTestId('panel-expand'));
    const panel = screen.getByTestId('doc-panel');
    expect(panel).toBeInTheDocument();
    expect(panel.getAttribute('data-tab')).toBe('chat');
    expect(screen.getByTestId('fake-thread')).toBeInTheDocument();
    // A flex SIBLING of the canvas container — reflow, not overlay (§7.3).
    const container = screen.getByTestId('document-canvas');
    expect(panel.parentElement).toBe(container.parentElement);
    expect(panel.style.width).toBe('min(440px, 40vw)');

    await userEvent.click(screen.getByTestId('panel-collapse'));
    expect(screen.queryByTestId('doc-panel')).toBeNull();
    expect(screen.getByTestId('doc-panel-rail')).toBeInTheDocument();
  });

  it('the band is VERSIONS ONLY: no chiclets, no toolbar, no toggle, no caption — pills with stamps', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    await screen.findByTestId('doc-canvas');
    const strip = screen.getByTestId('version-strip');
    expect(strip.getAttribute('data-variant')).toBe('slim');
    // The operator's list, verbatim: no Threads/toggle, no fork, no in-thread.
    expect(strip.querySelector('[data-testid="thread-toggle"]')).toBeNull();
    expect(strip.querySelector('[data-testid="version-fork"]')).toBeNull();
    expect(strip.querySelector('[data-testid="version-scroll"]')).toBeNull();
    expect(strip.querySelector('[data-testid="version-spine-caption"]')).toBeNull();
    expect(strip.querySelector('[data-testid="themes-open"]')).toBeNull();
    expect(strip.querySelector('[data-testid="export-menu"]')).toBeNull();
    // What remains: one pill per version, each with its number and stamp.
    expect(strip.querySelectorAll('[data-testid="version-entry"]')).toHaveLength(3);
    expect(strip.querySelectorAll('[data-testid="version-stamp"]')).toHaveLength(3);
  });

  it('export lives UNDER THE CHATBOX in the Chat tab (the moved slice-X click site)', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(
      <DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}}>
        {thread}
      </DocumentCanvas>,
    );
    await screen.findByTestId('doc-canvas');
    await userEvent.click(screen.getByTestId('panel-expand'));

    const chatBody = document.querySelector('[data-testid="panel-body"][data-tab="chat"]')!;
    const exportBlock = screen.getByTestId('chat-export');
    expect(chatBody.contains(exportBlock)).toBe(true);
    // The chat body's order: the thread first, the export block after it.
    expect(exportBlock.previousSibling).toBe(screen.getByTestId('fake-thread'));
    // The same slice-X control, addressing the shown version.
    expect(exportBlock.querySelector('[data-testid="export-menu"]'))
      .toHaveAttribute('data-version', '3');
  });

  it('the conversation stays REACHABLE while loading and on failure: the rail expands it (§1.2)', async () => {
    stubFetch({ '/api/versions': { status: 500, body: { error: 'versions.json is corrupt' } } });
    render(
      <DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}}>
        {thread}
      </DocumentCanvas>,
    );

    await screen.findByTestId('doc-canvas-error');
    expect(screen.queryByTestId('version-strip')).toBeNull();          // no manifest, no strip
    await userEvent.click(screen.getByTestId('panel-expand'));         // …but the thread is one click away
    expect(screen.getByTestId('fake-thread')).toBeInTheDocument();
    // Doc-scoped tabs are honest about needing a manifest: disabled with a reason.
    const compareTab = document.querySelector('[data-testid="panel-tab"][data-tab="compare"]')!;
    expect((compareTab as HTMLButtonElement).disabled).toBe(true);
    expect(compareTab.getAttribute('title')).toMatch(/open a document/i);
  });

  it('the doc-less picker keeps the panel OPEN on Chat beside it (its empty state points there), with no strip', async () => {
    stubFetch({ '/api/docs': { body: [] } });
    render(
      <DocumentCanvas projectId={PROJECT} docId={null} navigate={() => {}}>
        {thread}
      </DocumentCanvas>,
    );

    await screen.findByTestId('doc-picker-empty');
    const panel = screen.getByTestId('doc-panel');
    expect(panel.getAttribute('data-tab')).toBe('chat');
    expect(screen.getByTestId('fake-thread')).toBeInTheDocument();
    expect(screen.queryByTestId('version-strip')).toBeNull();
    // Nothing to export on the picker — the block waits for a document.
    expect(screen.queryByTestId('chat-export')).toBeNull();
  });

  it('§7.3 auto-hide: the strip retires after 3s idle and the bottom sensor wakes it', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);
    const strip = await screen.findByTestId('version-strip');
    expect(strip).toHaveAttribute('data-hidden', 'false');

    vi.useFakeTimers();
    try {
      act(() => { strip.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
      act(() => { vi.advanceTimersByTime(3100); });
      expect(strip).toHaveAttribute('data-hidden', 'true');
      expect(strip.style.opacity).toBe('0');
      // Round-3 J3: hit targets survive the visible fade — pointer events
      // retire only after STRIP_FADE_GRACE_MS, so a mid-fade click still
      // lands on the control instead of falling through to the sensor.
      expect(strip.style.pointerEvents).toBe('auto');
      act(() => { vi.advanceTimersByTime(400); }); // past the fade grace
      expect(strip.style.pointerEvents).toBe('none');

      const sensor = screen.getByTestId('strip-sensor');
      act(() => { sensor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true })); });
      expect(strip).toHaveAttribute('data-hidden', 'false');
      expect(strip.style.opacity).toBe('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('AC (§2.6 rule 3): a LANDED version re-reads the manifest — the strip advances, no reload', async () => {
    const grown: VersionManifest = {
      head: 4,
      versions: [...MANIFEST.versions, {
        version: 4, parent: 3, feedback_file: null, html_file: 'v4.html',
        created_at: '2026-08-18T11:00:00Z', meta: { sourceMessageId: 'dmsg-4' },
      }],
    };
    let reads = 0;
    stubFetch({ '/api/versions': { get body() { reads += 1; return reads === 1 ? MANIFEST : grown; } } });
    render(<DocumentCanvas projectId={PROJECT} docId={DOC} navigate={() => {}} />);

    expect(await screen.findByTestId('doc-canvas')).toHaveAttribute('data-version', '3');
    expect(screen.getAllByTestId('version-entry')).toHaveLength(3);
    // "No reload" is a claim about THIS node — the canvas surface itself. Hold its
    // identity now so the assertion below can be about the surface surviving the
    // re-read rather than about whichever iframe is mounted at the instant we look.
    const surface = screen.getByTestId('document-canvas');

    // The stream lands v4 (the docThread store's `landed` fact — same trigger
    // VideoStoryboard re-reads on). The strip must advance without a remount.
    act(() => { useDocThreadStore.setState({ landed: { [threadKey(PROJECT, DOC)]: 4 } }); });

    await waitFor(() => expect(screen.getAllByTestId('version-entry')).toHaveLength(4));
    // The frame follows the strip, one async hop behind it: advancing the shown
    // version RE-INSTRUMENTS the frame (DocFrame re-reads the version's HTML before
    // re-creating the iframe), so between the manifest landing and that read the
    // iframe is legitimately absent — the named loading state covers it. Wait for
    // the frame the landing produced instead of reading the DOM inside that gap;
    // reading it there is what made this case fail on CI and pass locally (#136),
    // because the stub answers in a microtask that a loaded runner reorders.
    await waitFor(() => expect(screen.getByTestId('doc-canvas')).toHaveAttribute('data-version', '4'));
    // …and the strip never blinked: the SAME canvas surface carried the re-read
    // from end to end — a reload would have replaced this node.
    expect(screen.getByTestId('document-canvas')).toBe(surface);
  });
});
