// AC3: video-record button derives state from GET /d/:doc/api/demo/status.
//
// Four scenarios per the AC spec:
//   1. Crew-triggered recording (no local POST) → data-state="recording" + disabled
//   2. status.posted {state:"working"} from any producer → same (via landed re-poll)
//   3. 409 in_flight body → remedy text verbatim, no retry suffix
//   4. #278 thread-error failure card unaffected by recording state
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VideoStoryboard } from '../src/components/VideoStoryboard.js';
import { ApiError } from '../src/api/errors.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-ac3';
const DEMO = 'my-demo';
const KEY = threadKey(PROJECT, DEMO);

const MANIFEST: VersionManifest = {
  head: 1,
  versions: [
    {
      version: 1, parent: null, feedback_file: null,
      html_file: '_v1.html', created_at: '2026-09-01T00:00:00Z',
    },
  ],
};

const getDemoStatusMock = vi.hoisted(() => vi.fn());
const getVersionsMock = vi.hoisted(() => vi.fn());
const getConversationMock = vi.hoisted(() => vi.fn());
const recordFromThreadMock = vi.hoisted(() => vi.fn());

vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  getDemoStatus: getDemoStatusMock,
  getVersions: getVersionsMock,
  getConversation: getConversationMock,
}));

vi.mock('../src/interactive/demoWire.js', async (orig) => ({
  ...(await orig<typeof import('../src/interactive/demoWire.js')>()),
  recordFromThread: recordFromThreadMock,
}));

/** Stubs global fetch: serves dummy storyboard HTML; rejects the webm Range probe. */
function stubFetch(): void {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).endsWith('.webm') || String(url).includes('.webm?')) {
      return Promise.resolve({
        ok: false, status: 404,
        headers: { get: () => null },
        body: null,
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: () => Promise.resolve('<html><body>storyboard</body></html>'),
    });
  }));
}

function mount(): void {
  render(
    <VideoStoryboard
      projectId={PROJECT}
      demoId={DEMO}
      version={null}
      navigate={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_API_HOST', '');
  Object.defineProperty(window, 'location', {
    value: new URL('http://127.0.0.1:7788/'),
    writable: true, configurable: true,
  });
  stubFetch();
  getVersionsMock.mockResolvedValue(MANIFEST);
  getConversationMock.mockResolvedValue([]);
  getDemoStatusMock.mockResolvedValue({ state: 'idle', in_flight: false });
  recordFromThreadMock.mockResolvedValue(undefined);
  useDocThreadStore.setState({
    messages: {}, genState: {}, boundRun: {}, pending: {},
    hydrated: {}, landed: {}, lastError: {}, lastSignalAt: {},
    held: {}, expectedDividers: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  getDemoStatusMock.mockReset();
  getVersionsMock.mockReset();
  getConversationMock.mockReset();
  recordFromThreadMock.mockReset();
});

describe('VideoStoryboard — record button state (AC3)', () => {
  it('crew-triggered recording: in_flight:true on mount → data-state="recording" + disabled, no POST needed', async () => {
    getDemoStatusMock.mockResolvedValue({ state: 'working', in_flight: true });

    mount();

    const btn = await screen.findByTestId('video-record');
    expect(btn).toHaveAttribute('data-state', 'recording');
    expect(btn).toBeDisabled();
    // No local POST was made — recordFromThread was never called.
    expect(recordFromThreadMock).not.toHaveBeenCalled();
  });

  it('status.posted from any producer → same: landed re-poll picks up in_flight:true', async () => {
    // Initially idle; will flip to recording after the landed frame triggers re-poll.
    getDemoStatusMock
      .mockResolvedValueOnce({ state: 'idle', in_flight: false })
      .mockResolvedValue({ state: 'working', in_flight: true });

    mount();

    // Wait for initial idle render.
    const btn = await screen.findByTestId('video-record');
    expect(btn).toHaveAttribute('data-state', 'idle');

    // Simulate a status.posted frame: increment landed in the thread store.
    await act(async () => {
      useDocThreadStore.setState((s) => ({
        landed: { ...s.landed, [KEY]: (s.landed[KEY] ?? 0) + 1 },
      }));
    });

    await waitFor(() => {
      expect(screen.getByTestId('video-record')).toHaveAttribute('data-state', 'recording');
    });
    expect(screen.getByTestId('video-record')).toBeDisabled();
  });

  it('409 in_flight body → remedy text verbatim, no "nothing was queued" retry suffix', async () => {
    recordFromThreadMock.mockRejectedValue(
      new ApiError(409, 'in_flight', {
        remedy: 'A recording is already in progress — wait for it to finish.',
        since: '2026-09-20T10:00:00Z',
      }),
    );

    mount();

    const btn = await screen.findByTestId('video-record');
    await userEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByTestId('video-record-error')).toBeInTheDocument();
    });

    const errSpan = screen.getByTestId('video-record-error');
    expect(errSpan.textContent).toContain('A recording is already in progress — wait for it to finish.');
    expect(errSpan.textContent).toContain('since 2026-09-20T10:00:00Z');
    // The retry suffix must NOT appear for a remedy answer.
    expect(errSpan.textContent).not.toContain('nothing was queued');
  });

  it('#278 thread-error failure card shows when threadError present, inFlight false, no recError', async () => {
    // Inject a thread error as if the bridge reported a recorder failure over the bus.
    useDocThreadStore.setState((s) => ({
      lastError: { ...s.lastError, [KEY]: { text: 'recorder exited with code 1 — check the bridge log' } },
    }));

    mount();

    // The failure card (data-source="thread") must be present.
    await waitFor(() => {
      const card = screen.getByTestId('video-record-error');
      expect(card).toHaveAttribute('data-source', 'thread');
      expect(card).toHaveTextContent('recorder exited with code 1');
    });

    // The record button itself must be in idle state (in_flight: false).
    expect(screen.getByTestId('video-record')).toHaveAttribute('data-state', 'idle');
  });
});
