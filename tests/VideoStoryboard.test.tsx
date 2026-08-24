// Unit tests for Video mode — REWIRED by DES-FEEDBACK-001 §7.4 (slice F).
//
// The client-side player (spec fetch, chapter scrub, <video>) is GONE: the routes it
// spoke never existed on the bridge. What this file pins instead:
//   1. The surface frames the storyboard HTML: `demo-player` IS an <iframe> whose src
//      is the REAL bridge route `/d/<demoId>/doc/<version>`, fully sandboxed.
//   2. None of the INVENTED routes are ever requested (spec / recordings / record).
//   3. The version strip addresses storyboard versions on the VIDEO route.
//   4. The thread is a drawer: closed by default with a demo open, open on the picker,
//      toggled from the strip (§7.3).
//   5. The picker orders most-recent first, lists only demos, invites creation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoStoryboard } from '../src/components/VideoStoryboard.js';
import { useDocThreadStore } from '../src/store/docThread.js';
import type { DocSummary } from '../src/api/interactive.js';
import { apiBase } from '../src/api/client.js';

const PROJECT = 'proj-abc-123';
const DEMO = 'checkout-walkthrough';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', { value: new URL(url), writable: true, configurable: true });
}

function prodOrigin(): void {
  vi.stubEnv('VITE_API_HOST', '');
  setLocation('http://127.0.0.1:7788/');
}

type Reply = { status?: number; body: unknown };

/** Route stubbed fetch by URL substring; an unmatched URL is a loud test failure. */
function stubFetch(routes: Record<string, Reply>): string[] {
  const seen: string[] = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    seen.push(url);
    const hit = Object.entries(routes).find(([frag]) => url.includes(frag));
    if (!hit) return Promise.reject(new Error(`unstubbed fetch: ${url}`));
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

const MANIFEST = {
  head: 2,
  kind: 'demo',
  versions: [
    { version: 1, parent: null, feedback_file: null, html_file: '_v1.html', created_at: '2026-08-17T10:00:00Z' },
    { version: 2, parent: 1, feedback_file: null, html_file: '_v2.html', created_at: '2026-08-18T11:30:00Z' },
  ],
};

const DEMOS: DocSummary[] = [
  { name: 'stale-demo', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-10T08:00:00Z' },
  { name: DEMO, kind: 'demo', head: 2, versions: 2, updated_at: '2026-08-18T11:30:00Z' },
  { name: 'onboarding-tour', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-17T16:00:00Z' },
];

beforeEach(() => {
  prodOrigin();
  // Isolate the shared thread store: hydration marks and the record control's
  // genState must not leak across tests.
  useDocThreadStore.setState({
    messages: {}, genState: {}, pending: {}, hydrated: {}, landed: {}, lastSignalAt: {},
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ── 1 + 2. The corrected wire: storyboard HTML in a sandboxed iframe ─────────

describe('the demo surface frames the storyboard (§7.4)', () => {
  it('demo-player IS an <iframe> at the REAL route /d/<id>/doc/<head>, sandboxed', async () => {
    const seen = stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);

    const player = await screen.findByTestId('demo-player');
    expect(player.tagName).toBe('IFRAME');
    expect(player).toHaveAttribute(
      'src',
      `${apiBase()}/projects/${PROJECT}/interactive/d/${DEMO}/doc/2`,
    );
    // Same full sandbox as Document mode: agent-authored HTML, nothing else granted.
    expect(player.getAttribute('sandbox')).toBe('allow-scripts');
    expect(player).toHaveAttribute('data-version', '2');
    // No <video>: the storyboard HTML owns playback via the bridge's player page.
    expect(screen.queryByTestId('demo-video')).toBeNull();
    // The one read is the manifest — through the project-scoped proxy.
    expect(seen.every((u) => u.startsWith(apiBase()))).toBe(true);
  });

  it('NEVER requests the invented routes (spec / recordings / record)', async () => {
    const seen = stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    await screen.findByTestId('demo-player');
    expect(seen.filter((u) => /\/api\/demo\/(spec|recordings|record)\b/.test(u))).toEqual([]);
  });

  it('the routed ?v addresses the frame; an unknown ?v resolves to the head', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    const { unmount } = render(
      <VideoStoryboard projectId={PROJECT} demoId={DEMO} version={1} navigate={() => {}} />,
    );
    expect(await screen.findByTestId('demo-player')).toHaveAttribute('data-version', '1');
    unmount();
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} version={99} navigate={() => {}} />);
    expect(await screen.findByTestId('demo-player')).toHaveAttribute('data-version', '2');
  });

  it('the version strip is present and selecting navigates on the VIDEO route', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    const navigate = vi.fn();
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={navigate} />);
    await screen.findByTestId('version-strip');

    const entries = screen.getAllByTestId('version-entry');
    expect(entries.map((e) => e.getAttribute('data-version'))).toEqual(['1', '2']);
    const selects = screen.getAllByTestId('version-select');
    await userEvent.click(selects[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/video/${DEMO}?v=1`);
  });

  it('a manifest failure is an error surface with a retry — never a blank', async () => {
    stubFetch({ '/api/versions': { status: 503, body: { code: 'bridge_unavailable', hint: 'npx wicked-interactive serve' } } });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const hint = await screen.findByTestId('video-bridge-hint');
    expect(hint).toHaveTextContent('npx wicked-interactive serve');
    expect(screen.getByTestId('video-canvas-retry')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-player')).toBeNull();
  });
});

// ── 4. The tabbed right panel (VIDEO-FB parity with the Document surface) ─────

describe('the right panel', () => {
  const thread = <aside data-testid="fake-thread">the conversation</aside>;

  it('is COLLAPSED to the rail with a demo open; the rail expands it and back', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(
      <VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}}>
        {thread}
      </VideoStoryboard>,
    );
    await screen.findByTestId('demo-player');
    expect(screen.getByTestId('doc-panel-rail')).toBeInTheDocument();
    expect(screen.queryByTestId('doc-panel')).toBeNull();
    expect(screen.queryByTestId('fake-thread')).toBeNull();

    await userEvent.click(screen.getByTestId('panel-expand'));
    expect(screen.getByTestId('doc-panel')).toBeInTheDocument();
    expect(screen.getByTestId('fake-thread')).toBeInTheDocument();
    // The four Document-surface tabs, verbatim — parity is the requirement.
    expect(screen.getAllByTestId('panel-tab').map((t) => t.getAttribute('data-tab')))
      .toEqual(['chat', 'compare', 'theme', 'versions']);

    await userEvent.click(screen.getByTestId('panel-collapse'));
    expect(screen.queryByTestId('doc-panel')).toBeNull();
    expect(screen.getByTestId('doc-panel-rail')).toBeInTheDocument();
  });

  it('a rail tab expands STRAIGHT onto its tab', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(
      <VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}}>
        {thread}
      </VideoStoryboard>,
    );
    await screen.findByTestId('demo-player');
    const railTabs = screen.getAllByTestId('panel-rail-tab');
    const versionsTab = railTabs.find((t) => t.getAttribute('data-tab') === 'versions');
    await userEvent.click(versionsTab!);
    expect(screen.getByTestId('doc-panel')).toHaveAttribute('data-tab', 'versions');
    // The Versions tab speaks the DEMO's noun, never "document" (VIDEO-FB copy).
    expect(screen.getByTestId('versions-history-note').textContent).toContain('demo’s own version manifest');
  });

  it('is OPEN by default on the picker — the wizard and the invitation live there', async () => {
    stubFetch({ '/api/docs': { body: DEMOS } });
    render(
      <VideoStoryboard projectId={PROJECT} demoId={null} navigate={() => {}}>
        {thread}
      </VideoStoryboard>,
    );
    await screen.findByTestId('demo-picker');
    expect(screen.getByTestId('doc-panel')).toBeInTheDocument();
    expect(screen.getByTestId('fake-thread')).toBeInTheDocument();
  });
});

// ── VIDEO-FB finding 2: the record affordance on the surface ─────────────────

describe('the Record control', () => {
  it('speaks demo.requested at the click site and answers there (EC37)', async () => {
    stubFetch({
      '/api/versions': { body: MANIFEST },
      '/api/events': { body: { ok: true, event_id: 'e1', correlation_id: 'c1' } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const button = await screen.findByTestId('video-record');
    expect(button).toHaveAttribute('data-state', 'idle');
    // Honest copy at the affordance: it re-records the authored steps.
    expect(button.getAttribute('title')).toContain('re-records');
    expect(button.getAttribute('title')).toContain('does not change the steps');

    await userEvent.click(button);
    // The wire is the REAL record trigger — demo.requested over POST /api/events.
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const eventCall = fetchMock.mock.calls.find(([u]) => String(u).includes('/api/events'));
    expect(eventCall).toBeDefined();
    const body = JSON.parse((eventCall![1] as RequestInit).body as string) as {
      event_type: string; payload: { document_id: string };
    };
    expect(body.event_type).toBe('wicked.interactive.demo.requested');
    expect(body.payload.document_id).toBe(DEMO);
    // Point-of-action: the button itself wears the pending state until the run
    // resolves (the thread store's genState — set by recordFromThread).
    expect(screen.getByTestId('video-record')).toHaveAttribute('data-state', 'recording');
    expect(screen.getByTestId('video-record')).toBeDisabled();
  });
});

// ── §7.3: the strip auto-hides and wakes on proximity ────────────────────────

describe('version strip auto-hide', () => {
  it('retires after 3s of idleness; the bottom sensor wakes it', async () => {
    stubFetch({ '/api/versions': { body: MANIFEST } });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const strip = await screen.findByTestId('version-strip');
    expect(strip).toHaveAttribute('data-hidden', 'false');

    vi.useFakeTimers();
    try {
      // Re-arm the timer under fake time, then let it elapse.
      act(() => {
        strip.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      });
      act(() => { vi.advanceTimersByTime(3100); });
      expect(strip).toHaveAttribute('data-hidden', 'true');
      expect(strip.style.opacity).toBe('0');
      // Round-3 J3: hit targets survive the visible fade — pointer events
      // retire only after STRIP_FADE_GRACE_MS, so a mid-fade click still
      // lands on the control instead of falling through to the sensor.
      expect(strip.style.pointerEvents).toBe('auto');
      act(() => { vi.advanceTimersByTime(400); }); // past the fade grace
      expect(strip.style.pointerEvents).toBe('none');

      // Proximity: the sensor exists only while hidden, and a mousemove wakes.
      const sensor = screen.getByTestId('strip-sensor');
      act(() => {
        sensor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
      });
      expect(strip).toHaveAttribute('data-hidden', 'false');
      expect(strip.style.opacity).toBe('1');
      expect(screen.queryByTestId('strip-sensor')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 5. Demo picker (unchanged behaviour) ─────────────────────────────────────

describe('demo picker (§6.3’s pattern, applied to demos)', () => {
  it('lists demos most-recent first and navigates into the demo route', async () => {
    stubFetch({ '/api/docs': { body: DEMOS } });
    const navigate = vi.fn();
    render(<VideoStoryboard projectId={PROJECT} demoId={null} navigate={navigate} />);

    const rows = await screen.findAllByTestId('demo-picker-row');
    expect(rows.map((r) => r.getAttribute('data-demo-id')))
      .toEqual([DEMO, 'onboarding-tour', 'stale-demo']);
    await userEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/video/${DEMO}`);
  });

  it('filters the ONE registry to kind:"demo" — documents never appear', async () => {
    stubFetch({
      '/api/docs': {
        body: [...DEMOS,
          { name: 'q3-report', kind: 'doc', head: 1, versions: 1, updated_at: '2026-08-19T00:00:00Z' }],
      },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={null} navigate={() => {}} />);
    const rows = await screen.findAllByTestId('demo-picker-row');
    expect(rows.map((r) => r.getAttribute('data-demo-id'))).not.toContain('q3-report');
  });

  it('an empty project invites creating a demo from the thread, never a blank', async () => {
    stubFetch({ '/api/docs': { body: [] } });
    render(<VideoStoryboard projectId={PROJECT} demoId={null} navigate={() => {}} />);
    const empty = await screen.findByTestId('demo-picker-empty');
    expect(empty).toHaveTextContent(/thread/i);
  });
});
