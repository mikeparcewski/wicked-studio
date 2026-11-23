import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { api } from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { TeamRosterView } from '../src/components/session/TeamRosterLines.js';
import { RunBaseNote, RunStory } from '../src/components/session/RunRecord.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { makeUnit, makeView } from './factories.js';

const path = (field: string): string => `/home/reel-operator/${field}`;
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetRunPanel(); });
it('masks run-picker titles, delivery and acceptance reasons, monitor errors and recorded notes', async () => {
  resetRunPanel();
  setCachedRoster([]);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] });
  vi.spyOn(api, 'getRunAcceptance').mockResolvedValue({ summary: { line: path('acceptance'), satisfied: false } } as never);
  useRunAcceptanceStore.setState({ byRun: {} });
  useRunEventStore.setState({ byRun: {} });
  const story = (sendBackNote: string | null) => ({ rejectNote: null, rejected: null, sendBackNote, engineTimedOut: false, stop: null });
  useProvenanceStore.setState({ byRun: { rejected: { state: 'unknown' }, sentback: { state: 'unknown' }, base: { state: 'unknown' } }, rejectNotes: { rejected: path('reject') }, cancelStories: { sentback: story(path('send-back')) }, baseNotices: { base: path('base-note') } });
  await act(async () => { render(<>
    <RunTab runs={[makeView({ id: 'old-c3', problem: path('old-title'), status: 'completed' }), makeView({ id: 'run-c3', problem: path('title'), status: 'completed' }, [makeUnit({ id: 'run-c3:deliver', ord: 1, status: 'rejected', denial_reason: path('delivery') })])]} sessionId="session-c3" title="Job" />
    <TeamRosterView team={{ lead: null, watch: null, members: [{ seat: 'codex', status: 'failed', error: path('monitor') }], steps: [] }} roster={[]} />
    <RunStory view={makeView({ id: 'rejected', status: 'cancelled' })} />
    <RunStory view={makeView({ id: 'sentback', status: 'cancelled' })} />
    <RunBaseNote runId="base" />
  </>); });
  for (const [id, fields] of [
    ['run-tab-run-pick', ['old-title', 'title']], ['run-tab-delivery-reason', ['delivery']], ['run-tab-acceptance', ['acceptance']],
    ['run-tab-team-member-error', ['monitor']], ['failure-reject-note', ['reject']], ['failure-send-back-note', ['send-back']], ['run-base-unfetched', ['base-note']],
  ] as const) {
    const text = screen.getByTestId(id).textContent;
    for (const field of fields) expect.soft(text, field).toContain(`~/${field}`);
    expect.soft(text, id).not.toContain('reel-operator');
  }
  expect(useProvenanceStore.getState().rejectNotes.rejected).toBe(path('reject'));
});
