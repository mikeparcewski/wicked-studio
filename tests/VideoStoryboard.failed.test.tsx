// studio#278: a failed recording is VISIBLE — on the storyboard and in both pickers — from the
// bridge's persisted status (GET /d/:doc/api/demo/status), so a reload keeps it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { VideoStoryboard } from '../src/components/VideoStoryboard.js';
import { threadKey, useDocThreadStore } from '../src/store/docThread.js';
import type { VersionManifest } from '../src/api/interactive.js';

const PROJECT = 'proj-278';
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


const FAILED = {
  document_id: DEMO,
  state: 'failed',
  in_flight: false,
  since: '2026-09-28T10:00:00Z',
  step: { index: 1, label: 'Open the Studio Project' },
  error: {
    code: 'recording_step_failed',
    source: 'recorder',
    retryable: false,
    error: 'recording failed at step 1 (Open the Studio Project): page.waitForURL: Timeout 30000ms exceeded.',
    remedy: 'refine step 1 (Open the Studio Project) via the storyboard, then Re-record',
    step: { index: 1, label: 'Open the Studio Project' },
  },
};

describe('VideoStoryboard — a failed recording is visible (studio#278)', () => {
  it('renders the failure card with the step, the reason and the remedy from the bridge status on mount', async () => {
    getDemoStatusMock.mockResolvedValue(FAILED);
    mount();
    const card = await screen.findByTestId('demo-recording-failed');
    expect(card).toHaveAttribute('data-code', 'recording_step_failed');
    expect(screen.getByTestId('demo-recording-failed-step')).toHaveTextContent('Recording failed at step 1 (Open the Studio Project)');
    expect(screen.getByTestId('demo-recording-failed-reason')).toHaveTextContent('page.waitForURL: Timeout 30000ms exceeded.');
    expect(screen.getByTestId('demo-recording-failed-remedy')).toHaveTextContent('refine step 1 (Open the Studio Project) via the storyboard, then Re-record');
    expect(card).toHaveTextContent(/Say what to change in the chat/);
    // Re-record is still offered (the app may have been fixed) — and is not the only signal.
    expect(screen.getByTestId('video-record')).toHaveAttribute('data-state', 'idle');
  });

  it('survives a reload: a fresh mount with an EMPTY thread (no live error line) still shows the failure', async () => {
    getDemoStatusMock.mockResolvedValue(FAILED);
    mount();
    await screen.findByTestId('demo-recording-failed');
    cleanup();
    useDocThreadStore.setState({ lastError: {}, messages: {} });
    mount();
    expect(await screen.findByTestId('demo-recording-failed')).toBeInTheDocument();
    expect(useDocThreadStore.getState().lastError[KEY]).toBeUndefined();
  });

  it('a blocked write names the request (side_effect_blocked)', async () => {
    getDemoStatusMock.mockResolvedValue({
      ...FAILED,
      step: { index: 2, label: 'Launch a bug run' },
      error: {
        code: 'side_effect_blocked', source: 'recorder', retryable: false,
        error: 'the demo spec tried to change the app it records: step 2 (Launch a bug run) sent POST http://127.0.0.1:7701/api/v1/runs',
        remedy: 're-author step 2 (Launch a bug run) to show the flow without submitting it, then Re-record',
        step: { index: 2, label: 'Launch a bug run' },
        request: { method: 'POST', url: 'http://127.0.0.1:7701/api/v1/runs' },
      },
    });
    mount();
    const card = await screen.findByTestId('demo-recording-failed');
    expect(card).toHaveAttribute('data-code', 'side_effect_blocked');
    expect(screen.getByTestId('demo-recording-failed-step')).toHaveTextContent('Recording failed at step 2 (Launch a bug run)');
    expect(screen.getByTestId('demo-recording-failed-reason')).toHaveTextContent('sent POST');
  });

  it('shows no failure card for an idle, recorded or in-flight demo — and the live step label reads the bridge\'s {index,label}', async () => {
    getDemoStatusMock.mockResolvedValue({ state: 'recorded', in_flight: false, version: 1, error: null });
    mount();
    await screen.findByTestId('video-record');
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('demo-recording-failed')).toBeNull();
    cleanup();
    getDemoStatusMock.mockResolvedValue({ state: 'recording', in_flight: true, step: { index: 2, label: 'Open a run' } });
    mount();
    await waitFor(() => expect(screen.getByTestId('video-record')).toHaveTextContent('Recording — step 2: Open a run'));
    expect(screen.queryByTestId('demo-recording-failed')).toBeNull();
  });
});
