import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WatchFinding } from '../src/api/watch-wire.js';
import { EMPTY_WATCH, foldTeamFrame, foldWatchFrame, jumpPath, watchFeed } from '../src/store/watch.js';

/**
 * studio#888 (ASK-S3, second half): crew's ASK-C3 rows (crew `watch/checks/team-path.ts`, entries
 * `path-repicked`, `reviewer-absent`, `help-unanswered`, all enabled) reach the Watchtower as ordinary watch
 * findings. This pins that they show as rows and that each opens its chat's session: the row links to the run's
 * thread, and the session page moves a chat's run onto the chat, keeping the row's moment.
 */

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { makeView } = await import('./factories.js');

/** A C3 row as crew's registry raises it: a `flag`, with facts that name no path (so nothing corroborates it). */
function c3(over: Partial<WatchFinding>): WatchFinding {
  return {
    run_id: 'r-ask', ord: 5, attempt: 1, by: 'watch:path-repicked@1', at: 1_000, re: 'path.repicked#1',
    watch_id: 'w-repick', entry_id: 'path-repicked', entry_version: 1, check: 'deterministic:path_repicked',
    kind: 'flag', severity: 'medium', watch_kind: 'problem', attach: null, project_id: 'shop',
    sentence: 'codex takes over — claude stopped answering (timed out).',
    facts: { from: 'claude', to: 'codex', reason: 'timed out', pick_seq: 1 },
    anchor: { run_id: 'r-ask', ord: 5, attempt: 1, at: 900 }, evidence: [], model: null, rolled_up: 0,
    ...over,
  };
}
const raised = (payload: WatchFinding) => ({ type: 'watchEvent', event: { event_id: 1, event_type: 'wicked.crew.watch_finding.raised', payload } });

const ROWS: WatchFinding[] = [
  c3({}),
  c3({
    watch_id: 'w-reviewer', entry_id: 'reviewer-absent', check: 'deterministic:reviewer_absent', by: 'watch:reviewer-absent@1',
    severity: 'info', watch_kind: 'quiet', at: 1_100, sentence: 'No reviewer joined: no other helper is signed in.',
    facts: { member_id: 'm-1', seat: null, reason: 'no distinct signed-in seat' },
  }),
  c3({
    watch_id: 'w-help', entry_id: 'help-unanswered', check: 'deterministic:help_unanswered', by: 'watch:help-unanswered@1',
    severity: 'info', watch_kind: 'quiet', at: 1_200, sentence: 'A question to the helpers went unanswered (timed out).',
    facts: { help_id: 'h-1', outcome: 'timed_out', question: 'Which config wins?', error: null },
  }),
];

beforeEach(() => {
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 404, headers: { 'content-type': 'application/json' } }))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.pushState({}, '', '/'); });

describe('studio#888: the ask path’s Watchtower rows', () => {
  it('each C3 finding is its own row, in its kind', () => {
    let f = EMPTY_WATCH;
    for (const r of ROWS) f = foldWatchFrame(f, raised(r));
    expect(watchFeed(f).map((r) => [r.id, r.kind, r.state])).toStrictEqual([
      ['w-help', 'quiet', 'open'], ['w-reviewer', 'quiet', 'open'], ['w-repick', 'problem', 'open'],
    ]);
    for (const r of watchFeed(f)) expect(jumpPath(r)).toBe('/s/run%3Ar-ask?jump=5:1:900');
  });

  it('a team finding on the same run, step and attempt never absorbs them: they name no path (codex r1)', () => {
    const team = (id: string, path: string | null) => ({ type: 'teamEvent', event: { event_type: 'wicked.team.finding.raised', payload: {
      finding_id: id, run_id: 'r-ask', ord: 5, attempt: 1, at: 950, severity: 'medium', ...(path !== null ? { path } : {}) } } });
    let f = foldTeamFrame(EMPTY_WATCH, team('f-path', 'src/a.ts'));
    f = foldTeamFrame(f, team('f-nopath', null));
    for (const r of ROWS) f = foldWatchFrame(f, raised(r));
    f = foldTeamFrame(f, team('f-late', 'src/b.ts'));
    for (const r of ROWS) expect(f.rows[r.watch_id]!.foldedInto).toBeNull();
    for (const id of ['team:f-path', 'team:f-nopath', 'team:f-late']) expect(f.rows[id]!.corroboratedBy).toStrictEqual([]);
    expect(watchFeed(f).map((r) => r.id).sort()).toStrictEqual(['team:f-late', 'team:f-nopath', 'team:f-path', 'w-help', 'w-repick', 'w-reviewer']);
  });

  it('the row’s address opens the chat the run belongs to (a run in the index), at the row’s moment', () => {
    useCapabilities.setState({ loaded: true, runChatId: true });
    window.history.pushState({}, '', '/s/run%3Ar-ask?jump=5:1:900');
    const navigate = vi.fn();
    const run = makeView({ id: 'r-ask', status: 'executing', problem: 'why does the build fail', chat_id: 'chat-9' } as never);
    render(<SessionPage sessionId="run:r-ask" runs={[run]} runsLoaded needRows={[]} navigate={navigate} onAsk={() => {}} />);
    expect(navigate).toHaveBeenCalledWith('/s/chat-9?jump=5%3A1%3A900&jumpRun=r-ask', { replace: true });
  });
});
