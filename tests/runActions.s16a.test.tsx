// S16a-1d: the run page header's actions under the session — Retry (the Desk row's prefill, the
// launch form, no request), Archive (its confirm, then exactly one POST /runs/:id/archive; the thread
// stays and says Archived), Draft update (the same Modal + OutboundDraft, nothing posted), the run's
// technical handles (hidden while the setting is off), and the ⌘K rows with their reasons.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SessionView } from '../src/api/types.js';
import { SheetRunActions } from '../src/components/session/RunActions.js';
import { RunBlock } from '../src/components/session/SessionView.js';
import { objectCommands } from '../src/components/sheets/objectCommands.js';
import { clearRetryPrefill, peekRetryPrefill } from '../src/store/retryPrefill.js';
import { useRunEventStore } from '../src/store/events.js';
import { DEFAULT_VIEW_PREFS, useViewPrefsStore } from '../src/store/viewPrefs.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-act';
let calls: { method: string; url: string }[] = [];

beforeEach(() => {
  calls = [];
  clearRetryPrefill();
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: true, persist: 'unknown' });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(url) });
    const body = String(url).includes('/deliver-text') ? 'A draft update.' : String(url).includes('/archive') ? JSON.stringify({ runId: RUN, archived: true }) : JSON.stringify({});
    return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': String(url).includes('/deliver-text') ? 'text/plain' : 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const posts = (): { method: string; url: string }[] => calls.filter((c) => c.method !== 'GET');

function run(status: SessionView['session']['status'], over: Record<string, unknown> = {}): SessionView {
  return makeView({ id: RUN, status, problem: 'Fix the double charge', clis: ['claude'], base_commit: 'abcdef1234567', ...over },
    [makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 0, status: status === 'executing' ? 'distributed' : 'done' })]);
}

describe('S16a-1d — Retry', () => {
  it('a failed run’s head offers Retry: it deposits the Desk row’s prefill and opens the launch form — no request', async () => {
    const navigate = vi.fn();
    render(<RunBlock view={run('failed')} badge={0} sessionId={`run:${RUN}`} navigate={navigate} />);
    const before = calls.length;
    await userEvent.click(screen.getByTestId('session-run-retry'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/runs/new');
    expect(peekRetryPrefill()).toMatchObject({ retryOf: RUN, problem: 'Fix the double charge' });
    expect(calls.slice(before)).toEqual([]);
  });

  it('a running or finished run offers no Retry', () => {
    render(<RunBlock view={run('executing')} badge={0} sessionId={`run:${RUN}`} navigate={() => {}} />);
    expect(screen.queryByTestId('session-run-retry')).toBeNull();
    cleanup();
    render(<RunBlock view={run('completed')} badge={0} sessionId={`run:${RUN}`} navigate={() => {}} />);
    expect(screen.queryByTestId('session-run-retry')).toBeNull();
  });
});

describe('S16a-1d — Archive and Draft update in the session sheet', () => {
  it('Archive asks first, then sends exactly one POST /runs/:id/archive and says Archived', async () => {
    render(<SheetRunActions view={run('completed')} />);
    await userEvent.click(screen.getByTestId('sheet-archive'));
    expect(posts()).toEqual([]);
    expect(screen.getByTestId('sheet-archive-confirm')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('sheet-archive-yes'));
    await screen.findByTestId('sheet-archived');
    expect(posts()).toHaveLength(1);
    expect(posts()[0]!.method).toBe('POST');
    expect(posts()[0]!.url).toContain(`/runs/${RUN}/archive`);
    expect(screen.queryByTestId('sheet-archive')).toBeNull();
  });

  it('Keep closes the confirm and sends nothing; a running or archived run offers no Archive', async () => {
    render(<SheetRunActions view={run('completed')} />);
    await userEvent.click(screen.getByTestId('sheet-archive'));
    await userEvent.click(screen.getByTestId('sheet-archive-keep'));
    expect(screen.getByTestId('sheet-archive')).toBeInTheDocument();
    expect(posts()).toEqual([]);
    cleanup();
    render(<SheetRunActions view={run('executing')} />);
    expect(screen.queryByTestId('sheet-archive')).toBeNull();
    cleanup();
    render(<SheetRunActions view={run('completed', { archived_at: 1_700_000_000 })} />);
    expect(screen.queryByTestId('sheet-archive')).toBeNull();
    expect(screen.getByTestId('sheet-archived')).toBeInTheDocument();
  });

  it('Draft update opens the draft (finished or in flight) — nothing is posted', async () => {
    render(<SheetRunActions view={run('executing')} />);
    await userEvent.click(screen.getByTestId('sheet-draft-update'));
    await waitFor(() => expect(screen.getByTestId('outbound-draft')).toBeInTheDocument());
    expect(posts()).toEqual([]);
  });
});

describe('S16a-1d — technical handles', () => {
  it('hidden while the setting is off; the run’s handles on its head when on', () => {
    const { unmount } = render(<RunBlock view={run('completed')} badge={0} sessionId={`run:${RUN}`} />);
    expect(screen.queryByTestId('tech-session-run')).toBeNull();
    unmount();
    act(() => { useViewPrefsStore.setState({ prefs: { ...DEFAULT_VIEW_PREFS, technical_details: true } }); });
    render(<RunBlock view={run('completed')} badge={0} sessionId={`run:${RUN}`} />);
    expect(screen.getByTestId('tech-session-run')).toHaveTextContent(`run ${RUN}`);
  });
});

describe('S16a-1d — ⌘K on the pointed session', () => {
  it('lists Retry / Archive / Draft, each disabled with its reason when it does not apply', () => {
    const ctx = (v: SessionView) => ({ runs: [v], navigate: () => {}, runChatId: false });
    const ref = { kind: 'session' as const, sessionId: `run:${RUN}` };
    const live = objectCommands(ref, ctx(run('executing'))).rows;
    expect(live.find((r) => r.id === 'retry')!.disabled).toBe('It is still running.');
    expect(live.find((r) => r.id === 'archive')!.disabled).toBe('It is still running.');
    expect(live.find((r) => r.id === 'draft')!.disabled).toBeNull();
    const archived = objectCommands(ref, ctx(run('cancelled', { archived_at: 9 }))).rows;
    expect(archived.find((r) => r.id === 'retry')!.disabled).toBeNull();
    expect(archived.find((r) => r.id === 'archive')!.disabled).toBe('It is already archived.');
  });
});
