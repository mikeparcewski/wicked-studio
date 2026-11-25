/**
 * studio#1437 (W12; the live proof wicked-core#1930 F8 asks for): a seated stand-in is named as one everywhere
 * studio names a seat. Fixture: the recorded wire of run b0ade71f (train 14), where the engine seated `claude~1`
 * (review) and `claude~2` (judge) and studio 0.16.18 still said "claude~1 reviews".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fixture from './fixtures/run-b0ade71f-standin.json';
import type { SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import * as sheets from '../src/store/sheets.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { helperNamer } from '../src/board/standIn.js';
import { seatLabel } from '../src/board/seatNames.js';
import { cliLabel } from '../src/api/skillUsage.js';
import { seatResponder } from '../src/board/responder.js';
import { seatName } from '../src/board/gateHeadline.js';
import { handoffRow } from '../src/board/powerMode.js';
import { sandboxOwner } from '../src/components/denialCopy.js';
import { skipReasonWord } from '../src/board/assuranceModel.js';
import type { HandoffStep } from '../src/api/power.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }) } };
});

const FIXTURE = fixture as unknown as { run: SessionView };
const RUN = FIXTURE.run;
const ROSTER = [{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }];
const REVIEW = "Claude Code stood in for the review, using Claude Code's default model: only Claude Code was signed in";
const JUDGE = "Claude Code stood in for the judge, using Claude Code's default model: only Claude Code was signed in";
const BARE = /\bclaude~\d/;

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  sheets.useSheets.setState({ open: null, pointed: null, stopping: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  setCachedRoster(ROSTER);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('studio#1437: a seated stand-in is named as one (run b0ade71f)', () => {
  it('every shared namer says "(stand-in)" and never the bare key, for the reviewer and the judge', () => {
    for (const key of ['claude~1', 'claude~2']) {
      expect(cliLabel(key)).toBe('Claude Code (stand-in)');
      expect(seatLabel({ key })).toBe('Claude Code (stand-in)');
      expect(helperNamer(ROSTER)(key)).toBe('Claude Code (stand-in)');
      expect(seatResponder(key, ROSTER).name).toBe('Claude Code (stand-in)');
      expect(seatName(key, null)).toBe('Claude Code (stand-in)');
      expect(seatName(key, 'Claude Code')).toBe('Claude Code (stand-in)');
      expect(sandboxOwner(key, ROSTER)).toBe('Claude Code (stand-in)');
    }
    // An ordinary seat keeps its name.
    expect(seatResponder('claude', ROSTER).name).toBe('Claude Code');
  });

  it('the hand-off row names the stand-in reviewer and never says "on its own seat"', () => {
    const steps = (RUN.session as unknown as { power: { handoff: { steps: HandoffStep[] } } }).power.handoff.steps;
    const review = steps.filter((s) => s.step === 'review').at(-1)!;
    expect(review.seat).toBe('claude~1');
    const row = handoffRow(review, 'standard', (cli) => seatResponder(cli, ROSTER).name);
    expect(row.who).toBe('Claude Code (stand-in)');
    expect(row.role).toBe('a stand-in review, not a different helper');
    expect(row.role).not.toMatch(/own seat/);
  });

  it('a receipt\'s stand_in skip reads as a stand-in', () => {
    expect(skipReasonWord('stand_in')).toBe('a stand-in checked instead');
  });

  it('the run panel names the stand-in and shows the engine\'s words for the review and the judge', async () => {
    let result!: ReturnType<typeof render>;
    await act(async () => { result = render(<RunTab runs={[RUN]} sessionId="chat-1" title="Stand-in job" />); });
    const helpers = screen.getByTestId('run-tab-glance-helpers').textContent ?? '';
    expect(helpers).toContain('Claude Code (stand-in)');
    expect(helpers).not.toMatch(BARE);
    const standIns = screen.getByTestId('run-tab-glance-standins').textContent ?? '';
    expect(standIns).toContain(REVIEW);
    expect(standIns).toContain(JUDGE);
    const toggle = screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === 'agents')!;
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    const agent = screen.getAllByTestId('run-tab-agent').find((li) => li.dataset['cli'] === 'claude~1')!;
    expect(agent.textContent).toContain('Claude Code (stand-in)');
    expect(agent.textContent).toContain(REVIEW);
    expect(result.container.textContent ?? '').not.toMatch(BARE);
  });
});
