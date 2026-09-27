// Studio Wave C (lane "home-runs") — ideas 10, 11 and 15 from the actionable-studio brainstorm:
//   10 just the top one: Home's header toggle holds the highest-consequence Needs You item and says
//      how many are hidden; the rest come back when it clears or the toggle goes off;
//   11 next-use moves: a finished run on the Runs list offers "Reuse as preset" (PUT /presets/:name,
//      the consequence said first) and "Draft update", beside Archive;
//   15 freeze deliveries: one switch in the status bar; while it is on a deliver approve is refused
//      with crew's message and the banner says who froze it; unfreezing lets the approve through.

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { confirmGate, putPreset, presets, freezeGet, freezePut } = vi.hoisted(() => ({
  confirmGate: vi.fn(),
  putPreset: vi.fn(),
  presets: vi.fn(),
  freezeGet: vi.fn(),
  freezePut: vi.fn(),
}));
vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, confirmGate } };
});
vi.mock('../src/api/teamPlan.js', async (orig) => {
  const real = await orig<typeof import('../src/api/teamPlan.js')>();
  return { ...real, teamPlanApi: { ...real.teamPlanApi, putPreset, presets } };
});
vi.mock('../src/api/deliveryFreeze.js', async (orig) => {
  const real = await orig<typeof import('../src/api/deliveryFreeze.js')>();
  return { ...real, deliveryFreezeApi: { get: freezeGet, put: freezePut } };
});

import { ApiError } from '../src/api/errors.js';
import type { WorkUnit } from '../src/api/types.js';
import { focusLockNote, focusLockView, groupAlike, topItem } from '../src/board/needsQueue.js';
import { SEVERITY, type NeedRow } from '../src/board/needsYou.js';
import { presetStepsOf, reuseConsequence } from '../src/board/runReuse.js';
import { sendGateDecision, useGateActionStore } from '../src/board/gateActions.js';
import { DeliveryFreezeSwitch } from '../src/components/DeliveryFreezeSwitch.js';
import { FinishedRunRow } from '../src/components/FinishedRunRow.js';
import { FocusLockToggle, NeedsQueueSurface } from '../src/components/NeedsYouQueue.js';
import { useDeliveryFreezeStore } from '../src/store/deliveryFreeze.js';
import { useFocusLockStore } from '../src/store/focusLock.js';
import { makeView } from './factories.js';

const NOW = Date.UTC(2026, 8, 27, 12);
const MIN = 60_000;

afterEach(cleanup);
beforeEach(() => {
  useFocusLockStore.setState({ on: false, pinnedKey: null });
  useDeliveryFreezeStore.setState({ status: 'unknown', state: null, busy: false, error: null });
  for (const f of [confirmGate, putPreset, presets, freezeGet, freezePut]) f.mockReset();
});

function row(over: Partial<NeedRow> & { key: string }): NeedRow {
  return {
    kind: 'failed-run', severity: SEVERITY['failed-run'], stakes: 1, subject: over.key, text: `${over.key} line`, tone: 'fail',
    at: NOW - MIN, subjectPath: `/runs/${over.key}`, action: { kind: 'open', path: `/runs/${over.key}`, label: 'Open ›' }, ...over,
  } as NeedRow;
}

// A gate outranks every failure; two gates fold into a group, whose lead is the longest waiting.
const GATE_OLD = row({ key: 'gate:old', kind: 'gate', severity: SEVERITY.gate, tone: 'gate', groupKey: 'approval', at: NOW - 50 * MIN });
const GATE_NEW = row({ key: 'gate:new', kind: 'gate', severity: SEVERITY.gate, tone: 'gate', groupKey: 'approval', at: NOW - 5 * MIN });
const FAILS = [row({ key: 'fail:a' }), row({ key: 'fail:b' }), row({ key: 'fail:c' })];
const FLAT = [...FAILS, GATE_NEW, GATE_OLD];

describe('idea 10 — just the top one', () => {
  it('the top item is the lead of the top-ranked row (a group gives its highest member)', () => {
    const grouped = groupAlike(FLAT, NOW);
    expect(grouped[0]!.members).toHaveLength(2);
    expect(topItem(grouped)?.key).toBe('gate:old');
    expect(topItem([])).toBeNull();
  });

  it('the lock view holds exactly the pinned item and counts the rest as hidden; a cleared item lets go', () => {
    expect(focusLockView(FLAT, 'gate:old')).toEqual({ rows: [GATE_OLD], hidden: 4 });
    expect(focusLockView(FLAT.filter((r) => r.key !== 'gate:old'), 'gate:old')).toBeNull();
    expect(focusLockView(FLAT, null)).toBeNull();
    expect(focusLockNote(4)).toBe('4 hidden, back when this clears');
  });

  it('the toggle shows 1 item and says how many are hidden; turning it off restores every item', async () => {
    render(
      <>
        <FocusLockToggle items={FLAT.length} />
        <NeedsQueueSurface rows={FLAT} runs={[]} navigate={() => {}} now={NOW} />
      </>,
    );
    // Off: the gate group plus three failures, five items.
    expect(screen.getAllByTestId('need-row')).toHaveLength(4);
    expect(screen.getByTestId('needs-you-queue')).toHaveAttribute('data-count', '5');

    await userEvent.click(screen.getByTestId('home-focus-toggle'));
    expect(screen.getByTestId('home-focus-toggle')).toHaveAttribute('aria-pressed', 'true');
    const rows = screen.getAllByTestId('need-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('data-key', 'gate:old');
    expect(screen.getByTestId('needs-you-queue')).toHaveAttribute('data-count', '1');
    expect(screen.getByTestId('need-focus-note')).toHaveTextContent('4 hidden, back when this clears');

    await userEvent.click(screen.getByTestId('home-focus-toggle'));
    expect(screen.getAllByTestId('need-row')).toHaveLength(4);
    expect(screen.queryByTestId('need-focus-note')).toBeNull();
  });

  it('the hidden items come back by themselves when the held item clears (never lost)', async () => {
    const view = render(<NeedsQueueSurface rows={FLAT} runs={[]} navigate={() => {}} now={NOW} />);
    act(() => useFocusLockStore.getState().setOn(true));
    await waitFor(() => expect(screen.getAllByTestId('need-row')).toHaveLength(1));
    expect(useFocusLockStore.getState().pinnedKey).toBe('gate:old');

    // Another item resolving does not move the lock: the held one stays, one fewer is hidden.
    view.rerender(<NeedsQueueSurface rows={FLAT.filter((r) => r.key !== 'fail:a')} runs={[]} navigate={() => {}} now={NOW} />);
    expect(screen.getAllByTestId('need-row')).toHaveLength(1);
    expect(screen.getByTestId('need-focus-note')).toHaveTextContent('3 hidden');

    // The held gate is answered: it leaves the fold, the lock lets go, the rest are all there.
    view.rerender(<NeedsQueueSurface rows={FLAT.filter((r) => r.key !== 'fail:a' && r.key !== 'gate:old')} runs={[]} navigate={() => {}} now={NOW} />);
    await waitFor(() => expect(useFocusLockStore.getState().on).toBe(false));
    expect(screen.getAllByTestId('need-row').map((r) => r.getAttribute('data-key')).sort()).toEqual(['fail:b', 'fail:c', 'gate:new']);
    expect(screen.queryByTestId('need-focus-note')).toBeNull();
  });

  it('"Show all" in the note turns the lock off', async () => {
    render(<NeedsQueueSurface rows={FLAT} runs={[]} navigate={() => {}} now={NOW} />);
    act(() => useFocusLockStore.getState().setOn(true));
    await userEvent.click(await screen.findByTestId('need-focus-show-all'));
    expect(screen.getAllByTestId('need-row')).toHaveLength(4);
  });

  it('the toggle is not drawn when there is nothing to hide', () => {
    render(<FocusLockToggle items={1} />);
    expect(screen.queryByTestId('home-focus-toggle')).toBeNull();
  });
});

// ── idea 11 ────────────────────────────────────────────────────────────────────────────────────

function unit(runId: string, ord: number, stepId: string, catalog?: string): WorkUnit {
  return {
    id: `${runId}:${stepId}`, session_id: runId, ord, description: stepId, stage: 'build',
    assigned_cli: null, assigned_invocation: null, council_task_ref: null, routing: null, denial_reason: null,
    phase_ref: null, conformance_ref: null, phase_status: null, collection_scope: null, status: 'done',
    ...(catalog !== undefined ? { catalog } : {}),
  } as WorkUnit;
}

const PLAN_RUN = makeView({ id: 'r-reuse', status: 'completed', problem: 'Tidy the upload handler', workflow_id: 'r-reuse:plan-2' });
PLAN_RUN.units = [
  unit('r-reuse', 0, 'pa-scope', 'understand'),
  unit('r-reuse', 1, 'understand', 'understand'),
  unit('r-reuse', 2, 'build', 'build'),
  unit('r-reuse', 3, 'review', 'review'),
  unit('r-reuse', 4, 'deliver', 'deliver'),
];
const DEF_RUN = makeView({ id: 'r-def', status: 'completed', problem: 'a def run', workflow_id: 'bug' });
DEF_RUN.units = [unit('r-def', 0, 'build')];

describe('idea 11 — a finished run carries its next use', () => {
  it('the run plan is its catalog steps, without the launch machinery (PA scope, deliver)', () => {
    expect(presetStepsOf(PLAN_RUN)).toEqual([
      { catalog: 'understand', id: 'understand' }, { catalog: 'build', id: 'build' }, { catalog: 'review', id: 'review' },
    ]);
    expect(presetStepsOf(DEF_RUN)).toEqual([]);
  });

  it('the consequence names the steps and what a save replaces, and blocks a bad or built-in name', () => {
    const steps = presetStepsOf(PLAN_RUN);
    expect(reuseConsequence(steps, 'tidy', [])).toEqual({
      blocked: false,
      text: "Saves this run's 3 steps (understand → build → review) as the preset “tidy” for every project. A launch that names it runs the same plan; this run is not changed.",
    });
    const mine = { name: 'tidy', scope: 'global', created_by: 'api', updated_at: 1, steps: [{ catalog: 'build', id: 'build' }] };
    expect(reuseConsequence(steps, 'tidy', [mine]).text).toMatch(/Replaces your preset “tidy” \(1 step\)\.$/);
    const builtin = { ...mine, name: 'feature', created_by: 'builtin' };
    expect(reuseConsequence(steps, 'feature', [builtin])).toMatchObject({ blocked: true });
    expect(reuseConsequence(steps, 'has space', [])).toMatchObject({ blocked: true });
    expect(reuseConsequence([], 'x', [])).toMatchObject({ blocked: true });
    // While the presets are being read the save waits, and nothing is claimed about a replacement.
    expect(reuseConsequence(steps, 'tidy', 'loading')).toMatchObject({ blocked: true, waiting: true });
    expect(reuseConsequence(steps, 'tidy', 'loading').text).not.toMatch(/replace/i);
    expect(reuseConsequence(steps, 'tidy', null).text).toMatch(/A preset already named “tidy” would be replaced\.$/);
  });

  it('"Reuse as preset" shows the consequence first, then PUTs the preset', async () => {
    presets.mockResolvedValue({ presets: [] });
    putPreset.mockImplementation(async (name: string, body: { steps: unknown[] }) => ({
      preset: { name, scope: 'global', created_by: 'api', updated_at: 2, steps: body.steps },
    }));
    render(<FinishedRunRow view={PLAN_RUN} selectedRunId={null} onSelect={() => {}} onArchive={() => {}} />);
    await userEvent.click(screen.getByTestId('run-reuse-preset'));
    // Nothing is written by opening it.
    expect(putPreset).not.toHaveBeenCalled();
    const panel = screen.getByTestId('run-reuse-panel');
    const consequence = within(panel).getByTestId('run-reuse-consequence');
    expect(consequence).toHaveTextContent('Saves this run\'s 3 steps (understand → build → review) as the preset “tidy-the-upload-handler”');
    // The consequence precedes the button that acts.
    expect(consequence.compareDocumentPosition(within(panel).getByTestId('run-reuse-save')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.clear(screen.getByTestId('run-reuse-name'));
    await userEvent.type(screen.getByTestId('run-reuse-name'), 'tidy-upload');
    await userEvent.click(screen.getByTestId('run-reuse-save'));
    expect(putPreset).toHaveBeenCalledTimes(1);
    expect(putPreset).toHaveBeenCalledWith('tidy-upload', {
      steps: [{ catalog: 'understand', id: 'understand' }, { catalog: 'build', id: 'build' }, { catalog: 'review', id: 'review' }],
    });
    expect(await screen.findByTestId('run-reuse-saved')).toHaveTextContent('Saved as preset “tidy-upload”');
    expect(screen.queryByTestId('run-reuse-preset')).toBeNull();
  });

  it('a refused save says why in place and keeps the panel', async () => {
    presets.mockResolvedValue({ presets: [] });
    putPreset.mockRejectedValue(new ApiError(400, 'preset_invalid_steps: no creator step'));
    render(<FinishedRunRow view={PLAN_RUN} selectedRunId={null} onSelect={() => {}} onArchive={() => {}} />);
    await userEvent.click(screen.getByTestId('run-reuse-preset'));
    await userEvent.click(screen.getByTestId('run-reuse-save'));
    expect(await screen.findByTestId('run-reuse-error')).toHaveTextContent('preset_invalid_steps');
    expect(screen.getByTestId('run-reuse-panel')).toBeInTheDocument();
  });

  it('a run with no catalog plan offers no "Reuse as preset"; Draft update and Archive stay', async () => {
    const onArchive = vi.fn();
    render(<FinishedRunRow view={DEF_RUN} selectedRunId={null} onSelect={() => {}} onArchive={onArchive} />);
    expect(screen.queryByTestId('run-reuse-preset')).toBeNull();
    expect(screen.getByTestId('run-draft-update-row')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('run-archive-row'));
    expect(onArchive).toHaveBeenCalledWith('r-def');
  });
});

// ── idea 15 ────────────────────────────────────────────────────────────────────────────────────

const THAWED = { frozen: false, since: null, by: null, reason: null };
const FROZEN = { frozen: true, since: '2026-09-27T12:00:00.000Z', by: 'local', reason: 'incident 42' };
const FROZEN_BODY = {
  error: 'Deliveries are frozen by local since 2026-09-27T12:00:00.000Z (incident 42): nothing is pushed while the freeze is on. The gate stays open — unfreeze deliveries, then approve again.',
  code: 'deliveries_frozen',
};

describe('idea 15 — freeze deliveries', () => {
  it('no switch is drawn when the daemon cannot say', async () => {
    freezeGet.mockRejectedValue(new ApiError(404, 'Not Found'));
    await useDeliveryFreezeStore.getState().load();
    render(<DeliveryFreezeSwitch />);
    expect(screen.queryByTestId('delivery-freeze-open')).toBeNull();
  });

  it('freezing says what it does first, then PUTs; the banner names who and why', async () => {
    freezeGet.mockResolvedValue(THAWED);
    freezePut.mockResolvedValue(FROZEN);
    await useDeliveryFreezeStore.getState().load();
    render(<DeliveryFreezeSwitch />);
    await userEvent.click(screen.getByTestId('delivery-freeze-open'));
    expect(freezePut).not.toHaveBeenCalled();
    expect(screen.getByTestId('delivery-freeze-consequence')).toHaveTextContent(/no run pushes a branch or opens a PR until you unfreeze/);
    await userEvent.type(screen.getByTestId('delivery-freeze-reason'), 'incident 42');
    await userEvent.click(screen.getByTestId('delivery-freeze-confirm-btn'));
    expect(freezePut).toHaveBeenCalledWith({ frozen: true, reason: 'incident 42' });
    expect(await screen.findByTestId('delivery-freeze-banner')).toHaveTextContent(/Deliveries frozen by local .*incident 42/);
    expect(screen.getByTestId('delivery-freeze-open')).toHaveTextContent('Unfreeze');
  });

  it('while frozen a deliver approve is refused with a clear message; after unfreezing it goes through', async () => {
    freezeGet.mockResolvedValue(FROZEN);
    confirmGate.mockRejectedValueOnce(new ApiError(409, FROZEN_BODY.error, FROZEN_BODY));
    const refused = await sendGateDecision('r-deliver', { approve: true, ord: 5 });
    expect(refused).toMatch(/Deliveries are frozen by local/);
    expect(refused).toMatch(/unfreeze deliveries, then approve again/);
    // The refusal re-reads the switch, so the banner shows even when someone else froze it.
    await waitFor(() => expect(useDeliveryFreezeStore.getState().state).toEqual(FROZEN));
    expect(useGateActionStore.getState().byGate['r-deliver']?.answered ?? null).toBeNull();

    freezePut.mockResolvedValue(THAWED);
    expect(await useDeliveryFreezeStore.getState().set(false)).toBe(true);
    confirmGate.mockResolvedValueOnce({ status: 'executing' });
    expect(await sendGateDecision('r-deliver', { approve: true, ord: 5 })).toBeNull();
    expect(confirmGate).toHaveBeenCalledTimes(2);
  });
});
