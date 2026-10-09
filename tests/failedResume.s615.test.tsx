// studio#615: a failed run the engine can resume shows a Resume arm in its session block — one POST
// to /runs/:id/resume, no launch form — and the block says what to do ("Resume or start over").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionView } from '../src/api/types.js';
import { RunBlock } from '../src/components/session/SessionView.js';
import { useRunEventStore } from '../src/store/events.js';
import { DEFAULT_VIEW_PREFS, useViewPrefsStore } from '../src/store/viewPrefs.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-failed';
let calls: { method: string; url: string }[] = [];
let resumeStatus = 200;
let eventsFail = false;

beforeEach(() => {
  calls = [];
  resumeStatus = 200;
  eventsFail = false;
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: true, persist: 'unknown' });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url) });
    if (String(url).endsWith('/resume') && resumeStatus !== 200) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'run r-failed is not resumable: no unit at the cursor' }), { status: resumeStatus, headers: { 'content-type': 'application/json' } }));
    }
    if (String(url).includes('/events') && eventsFail) return Promise.reject(new Error('network down'));
    const body = String(url).endsWith('/resume') ? { status: 'awaiting_human' } : String(url).includes('/events') ? { events: [] } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const posts = (): { method: string; url: string }[] => calls.filter((c) => c.method !== 'GET');

function run(status: SessionView['session']['status'], over: Record<string, unknown> = {}): SessionView {
  return makeView({ id: RUN, status, problem: 'Add the composer options row', clis: ['claude'], ...over },
    [makeUnit({ id: `${RUN}:plan`, session_id: RUN, ord: 0, status: status === 'executing' ? 'distributed' : 'done' })]);
}

describe('studio#615 — Resume a failed run in place', () => {
  it('a failed run says what to do and Resume makes exactly one POST /resume — no launch form', async () => {
    const navigate = vi.fn();
    render(<RunBlock view={run('failed')} badge={1} sessionId={`run:${RUN}`} navigate={navigate} />);
    expect(screen.getByTestId('session-failed-resume').textContent).toMatch(/It stopped: Resume or start over/);
    expect(screen.getByTestId('session-run-retry')).toBeTruthy(); // start over stays its own action
    await userEvent.click(screen.getByTestId('session-failed-resume-button'));
    await waitFor(() => expect(screen.getByTestId('session-failed-resume-asked')).toBeTruthy());
    expect(posts()).toEqual([{ method: 'POST', url: expect.stringMatching(/\/runs\/r-failed\/resume$/) }]);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a refusal is said beside the arm, and the arm stays', async () => {
    resumeStatus = 409;
    render(<RunBlock view={run('failed')} badge={1} sessionId={`run:${RUN}`} navigate={() => {}} />);
    await userEvent.click(screen.getByTestId('session-failed-resume-button'));
    await waitFor(() => expect(screen.getByTestId('session-failed-resume-error').textContent).toMatch(/not resumable/));
    expect(screen.getByTestId('session-failed-resume-button')).toBeTruthy();
  });

  it('a failed event refresh after an accepted Resume still reads as asked — never a second POST', async () => {
    eventsFail = true;
    render(<RunBlock view={run('failed')} badge={1} sessionId={`run:${RUN}`} navigate={() => {}} />);
    await userEvent.click(screen.getByTestId('session-failed-resume-button'));
    await waitFor(() => expect(screen.getByTestId('session-failed-resume-asked')).toBeTruthy());
    expect(screen.queryByTestId('session-failed-resume-button')).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it('the same run failing again after a resume offers Resume again', async () => {
    const { rerender } = render(<RunBlock view={run('failed')} badge={1} sessionId={`run:${RUN}`} navigate={() => {}} />);
    await userEvent.click(screen.getByTestId('session-failed-resume-button'));
    await waitFor(() => expect(screen.getByTestId('session-failed-resume-asked')).toBeTruthy());
    rerender(<RunBlock view={run('executing')} badge={0} sessionId={`run:${RUN}`} navigate={() => {}} />);
    expect(screen.queryByTestId('session-failed-resume')).toBeNull();
    rerender(<RunBlock view={run('failed')} badge={1} sessionId={`run:${RUN}`} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('session-failed-resume-button')).toBeTruthy());
  });

  it('no Resume on a running, finished, cancelled or archived run', () => {
    for (const v of [run('executing'), run('completed'), run('cancelled'), run('failed', { archived_at: 1_700_000_000_000 })]) {
      render(<RunBlock view={v} badge={0} sessionId={`run:${RUN}`} navigate={() => {}} />);
      expect(screen.queryByTestId('session-failed-resume')).toBeNull();
      cleanup();
    }
  });
});
