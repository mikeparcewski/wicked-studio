// Unit tests for Video mode — DES-MERGE-001 §4.5, §6.4 slice 13.
//
// Four concerns, one per AC:
//   1. Storyboard: the spec's steps render as chapter cards, in spec order.
//   2. Chapter seek: clicking chapter N puts the playhead at that step's timestamp —
//      derived from SPEC STEP BOUNDARIES, never scraped off the video (§4.5).
//   3. ffmpeg absent: an ACTIONABLE message naming the install command, and the
//      storyboard STILL renders (degradation is required behaviour, not a nicety).
//   4. The picker orders most-recent first, lists only demos, and invites creation
//      rather than rendering blank.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  VideoStoryboard, chapterSeek, mmss, playerState,
} from '../src/components/VideoStoryboard.js';
import type { DemoStep, DocSummary } from '../src/api/interactive.js';
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

const STEPS: DemoStep[] = [
  { index: 0, title: 'Open the storefront', timestamp: 0 },
  { index: 1, title: 'Add a hoodie to the cart', timestamp: 6.5 },
  { index: 2, title: 'Enter the card details', timestamp: 12 },
  { index: 3, title: 'Confirm the order', timestamp: 21.25 },
];

const SPEC = { steps: STEPS, target_url: 'https://shop.example/' };

const DEMOS: DocSummary[] = [
  { name: 'stale-demo', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-10T08:00:00Z' },
  { name: DEMO, kind: 'demo', head: 2, versions: 2, updated_at: '2026-08-18T11:30:00Z' },
  { name: 'onboarding-tour', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-17T16:00:00Z' },
];

beforeEach(prodOrigin);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// ── 1 + 2. Storyboard and chapter seek ──────────────────────────────────────

describe('storyboard chapters (§4.5)', () => {
  it('renders one card per spec step, in spec order, with its timestamp', async () => {
    stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 2, gif_url: '/d/x/demo/v2.gif' } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);

    const cards = await screen.findAllByTestId('chapter-card');
    expect(cards).toHaveLength(STEPS.length);
    expect(cards.map((c) => c.getAttribute('data-index'))).toEqual(['0', '1', '2', '3']);
    expect(cards[1]).toHaveTextContent('Add a hoodie to the cart');
    expect(cards[3]).toHaveTextContent('0:21');
    expect(screen.getByTestId('demo-storyboard')).toHaveAttribute('data-steps', '4');
  });

  it('clicking chapter 3 seeks the player to that step’s timestamp', async () => {
    stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 2, video_url: '/d/x/demo/v2.mp4' } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const cards = await screen.findAllByTestId('chapter-card');

    // jsdom loads no media, so `currentTime` is the observable seek; the player reflects
    // it as `data-position` for the same reason Playwright can then assert it.
    await userEvent.click(cards[2]!);
    const player = screen.getByTestId('demo-player');
    expect(player).toHaveAttribute('data-chapter', '2');
    expect(player).toHaveAttribute('data-position', '12');
    expect((screen.getByTestId('demo-video') as HTMLVideoElement).currentTime).toBe(12);
    expect(cards[2]).toHaveAttribute('data-selected', 'true');
    expect(cards[0]).toHaveAttribute('data-selected', 'false');
  });

  it('with no recording, a chapter click focuses the step instead of seeking', async () => {
    stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 0 } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    const cards = await screen.findAllByTestId('chapter-card');
    const scrolled = vi.spyOn(cards[1]!, 'scrollIntoView');

    await userEvent.click(cards[1]!);
    expect(scrolled).toHaveBeenCalled();
    expect(screen.getByTestId('demo-player')).toHaveAttribute('data-chapter', '1');
    expect(screen.queryByTestId('demo-video')).toBeNull();
  });

  it('maps a chapter to its own boundary, clamped to a known duration', () => {
    expect(chapterSeek(STEPS[2]!)).toBe(12);
    // A spec re-authored against an older recording has steps past its end (slice 14).
    expect(chapterSeek(STEPS[3]!, 15)).toBe(15);
    expect(chapterSeek({ index: 0, title: 'x', timestamp: -4 })).toBe(0);
    expect(chapterSeek({ index: 0, title: 'x', timestamp: Number.NaN })).toBe(0);
    // An unknown duration (metadata not loaded) must not clamp to zero.
    expect(chapterSeek(STEPS[3]!, Number.NaN)).toBe(21.25);
    expect(mmss(21.25)).toBe('0:21');
    expect(mmss(64)).toBe('1:04');
  });

  it('spec URLs resolve through the project-scoped proxy — no second origin', async () => {
    const seen = stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 1, gif_url: '/d/x/demo/v1.gif' } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    await screen.findByTestId('demo-gif');

    for (const url of seen) {
      expect(url).toContain(`/api/v1/projects/${PROJECT}/interactive/d/${DEMO}/api/demo/`);
      expect(url).not.toContain('4400');
    }
    expect((screen.getByTestId('demo-gif') as HTMLImageElement).getAttribute('src'))
      .toBe(`${apiBase()}/projects/${PROJECT}/interactive/d/x/demo/v1.gif`);
  });
});

// ── 3. Missing ffmpeg (§4.5, §3.3) ──────────────────────────────────────────

describe('a missing ffmpeg is actionable, not fatal (§4.5)', () => {
  const HINT = 'brew install ffmpeg && wicked-crew restart';

  it('names the install command verbatim AND still renders the storyboard', async () => {
    stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 2, ffmpeg_absent: true, ffmpeg_hint: HINT } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);

    expect(await screen.findByTestId('demo-ffmpeg-hint')).toHaveTextContent(HINT);
    expect(screen.getByTestId('demo-no-recording')).toHaveAttribute('data-ffmpeg-absent', 'true');
    // The whole point: degradation, not a blank surface.
    expect(screen.getAllByTestId('chapter-card')).toHaveLength(STEPS.length);
    expect(screen.queryByTestId('video-canvas-error')).toBeNull();
  });

  it('offers the record action, and reports it as queued (§3.3: subject + control)', async () => {
    stubFetch({
      '/api/demo/spec': { body: SPEC },
      '/api/demo/recordings': { body: { version: 0 } },
      '/api/demo/record': { body: { queued: true } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);

    const record = await screen.findByTestId('demo-record');
    expect(screen.getByTestId('demo-no-recording')).toHaveAttribute('data-ffmpeg-absent', 'false');
    await userEvent.click(record);
    await waitFor(() => expect(screen.getByTestId('demo-record-queued')).toHaveTextContent(DEMO));
    expect(record).toBeDisabled();
  });

  it('a recording ERROR that names ffmpeg is read as the same missing dependency', () => {
    const state = playerState(PROJECT, null, { message: 'API 500: ffmpeg not found on PATH' });
    expect(state).toEqual({ kind: 'missing', ffmpeg: true, hint: 'API 500: ffmpeg not found on PATH' });
    // A bridge_unavailable hint wins over the message, and is carried verbatim.
    expect(playerState(PROJECT, null, { message: 'x', hint: 'run npx wicked-interactive serve' }))
      .toEqual({ kind: 'missing', ffmpeg: false, hint: 'run npx wicked-interactive serve' });
    // ffmpeg_absent with no hint still names a command rather than apologising.
    const bare = playerState(PROJECT, { version: 1, ffmpeg_absent: true }, null);
    expect(bare.kind === 'missing' && bare.hint).toMatch(/install ffmpeg/i);
    // Video wins over gif when the service produced both; both resolve through the proxy.
    expect(playerState(PROJECT, { version: 1, video_url: '/a.mp4', gif_url: '/a.gif' }, null))
      .toMatchObject({ kind: 'video', src: `${apiBase()}/projects/${PROJECT}/interactive/a.mp4` });
  });

  it('a spec that fails to load IS an error surface, with the hint and a retry', async () => {
    stubFetch({
      '/api/demo/spec': { status: 503, body: { code: 'bridge_unavailable', hint: 'npx wicked-interactive serve' } },
      '/api/demo/recordings': { status: 503, body: { code: 'bridge_unavailable', hint: 'npx wicked-interactive serve' } },
    });
    render(<VideoStoryboard projectId={PROJECT} demoId={DEMO} navigate={() => {}} />);
    expect(await screen.findByTestId('video-bridge-hint')).toHaveTextContent('npx wicked-interactive serve');
    expect(screen.getByTestId('video-canvas-retry')).toBeInTheDocument();
  });
});

// ── 4. The demo picker ──────────────────────────────────────────────────────

describe('demo picker (§6.3’s pattern, applied to demos)', () => {
  it('lists demos most-recent first and navigates into the demo route', async () => {
    stubFetch({ '/api/docs': { body: [...DEMOS, { name: 'q3-report', kind: 'doc', head: 1, versions: 1, updated_at: '2026-08-19T00:00:00Z' }] } });
    const navigate = vi.fn();
    render(<VideoStoryboard projectId={PROJECT} demoId={null} navigate={navigate} />);

    const rows = await screen.findAllByTestId('demo-picker-row');
    // The newest row overall is a DOC, and it is not here: Video mode lists demos.
    expect(rows.map((r) => r.getAttribute('data-demo-id')))
      .toEqual([DEMO, 'onboarding-tour', 'stale-demo']);
    await userEvent.click(rows[0]!);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/video/${DEMO}`);
  });

  it('an empty project invites creating a demo from the thread, never a blank', async () => {
    stubFetch({ '/api/docs': { body: [{ name: 'q3-report', kind: 'doc', head: 1, versions: 1, updated_at: null }] } });
    render(<VideoStoryboard projectId={PROJECT} demoId={null} navigate={() => {}} />);

    const empty = await screen.findByTestId('demo-picker-empty');
    expect(empty).toHaveTextContent(/thread/i);
    expect(empty.textContent ?? '').not.toMatch(/^\s*$/);
    expect(screen.queryByTestId('demo-picker')).toBeNull();
  });
});
