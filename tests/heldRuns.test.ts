import { afterEach, describe, expect, it } from 'vitest';
import { isHeldRun, markHeld } from '../src/board/heldRuns.js';
import { useHeldRuns } from '../src/store/heldRuns.js';
import { statusSentence } from '../src/board/proposalCard.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { nowStep } from '../src/components/session/ChainLine.js';
import { repoFleetModels } from '../src/board/repoStats.js';
import { statusCounts } from '../src/board/windowStats.js';
import type { RepoEntry } from '../src/api/types.js';
import { deskLiveCounts, statusWord } from '../src/board/statusWords.js';
import { liveRows, outcomeOf } from '../src/board/deskInsights.js';
import { makeUnit, makeView } from './factories.js';
import { runState, sessionState } from '../src/board/sessionModel.js';
import { railGroups } from '../src/board/deskModel.js';

/** studio#805: a live run a Needs-you row holds reads as waiting on you everywhere statusWord speaks. */
describe('held runs: one mark, read by statusWord', () => {
  const live = makeView({ id: 'r1', status: 'executing' });
  const gate = makeView({ id: 'g1', status: 'awaiting_human' });
  const done = makeView({ id: 'd1', status: 'completed' });

  it('marks only live runs in the held set, on a copy, and leaves the wire status alone', () => {
    const runs = [live, gate, done];
    const out = markHeld(runs, new Set(['r1', 'g1', 'd1']));
    expect(out.map((v) => isHeldRun(v.session))).toEqual([true, false, false]);
    expect(out[0]!.session.status).toBe('executing');
    expect(isHeldRun(live.session)).toBe(false);
    expect(markHeld(runs, new Set())).toBe(runs);
    expect(markHeld(runs, new Set(['g1']))).toBe(runs);
  });

  it('a held run is Waiting on you to statusWord, outcomeOf, the live count and Running now', () => {
    const [held] = markHeld([live], new Set(['r1']));
    expect(statusWord(live)).toEqual({ word: 'Working', tone: 'run' });
    expect(statusWord(held!)).toEqual({ word: 'Waiting on you', tone: 'gate' });
    expect(outcomeOf(held!)).toBe('Waiting on you');
    expect(deskLiveCounts([held!]).working).toBe(0);
    expect(liveRows([held!], () => 't')).toHaveLength(0);
    expect(liveRows([live], () => 't')).toHaveLength(1);
  });

  it('a held run is a waiting session to the rail, Everything and the session page (runState)', () => {
    const [held] = markHeld([live], new Set(['r1']));
    expect(sessionState(held!.session.status)).toBe('working');
    expect(runState(held!)).toBe('waiting');
    expect(runState(live)).toBe('working');
    expect(runState(gate)).toBe('waiting');
    expect(runState(done)).toBe('done');
  });

  it('the rail dot of a chat whose older run is held reads Waiting on you, not the newer run\'s word', () => {
    const older = makeView({ id: 'h1', status: 'executing', chat_id: 'c', created_at: 100 } as Parameters<typeof makeView>[0]);
    const newer = makeView({ id: 'n1', status: 'completed', chat_id: 'c', created_at: 200 } as Parameters<typeof makeView>[0]);
    const runs = markHeld([newer, older], new Set(['h1']));
    const [group] = railGroups([], runs, { h1: 1 }, 5, {}, true);
    expect(group!.sessions[0]!.status.word).toBe('Waiting on you');
  });

  it('an archived run still reads Archived', () => {
    const [held] = markHeld([makeView({ id: 'a1', status: 'executing', archived_at: 1 } as Parameters<typeof makeView>[0])], new Set(['a1']));
    expect(statusWord(held!).word).toBe('Archived');
  });
});

/**
 * crew#1042 (operator ruling 2026-10-18, option 2): the held set is a shared store, so the surfaces that
 * fetch their own runs — the run page, the repositories list, a repository's page — read the same
 * verdict as the Desk, by run id, without being handed a marked copy. Before it, the run page said
 * "Build is running" with a "now" badge, and the repositories said "1 working" / "Working now".
 */
describe('crew#1042: the shared held set reaches every surface', () => {
  const ORPHAN = 'r-orphan';
  const unit = makeUnit({ id: `${ORPHAN}:build`, session_id: ORPHAN, ord: 1, status: 'distributed', phase_ref: 'build' });
  const orphan = makeView({ id: ORPHAN, status: 'executing', repo_ref: 'acme', workflow_id: 'feature', unit_ix: 0 }, [unit]);
  afterEach(() => useHeldRuns.getState().setHeld(new Set()));

  it('isHeldRun reads the store by id for a LIVE run only, with no mark on the run', () => {
    expect(isHeldRun(orphan.session)).toBe(false);
    useHeldRuns.getState().setHeld(new Set([ORPHAN, 'g1', 'd1']));
    expect(isHeldRun(orphan.session)).toBe(true);
    expect(isHeldRun(makeView({ id: 'g1', status: 'awaiting_human' }).session)).toBe(false);
    expect(isHeldRun(makeView({ id: 'd1', status: 'completed' }).session)).toBe(false);
  });

  it('a set with the same members keeps the old one (no re-render for nothing)', () => {
    useHeldRuns.getState().setHeld(new Set([ORPHAN]));
    const first = useHeldRuns.getState().held;
    useHeldRuns.getState().setHeld(new Set([ORPHAN]));
    expect(useHeldRuns.getState().held).toBe(first);
  });

  it('the run page: the status sentence waits on you, and the chain marks the step "waiting on you", not "now"', () => {
    const chain = chainFromUnits(orphan);
    expect(statusSentence(orphan, chain, undefined)).toBe('Build is running · 0 of 1 done');
    expect(nowStep(chain, orphan.units, null, 'working')).toMatchObject({ kind: 'run', word: 'now' });
    useHeldRuns.getState().setHeld(new Set([ORPHAN]));
    expect(statusSentence(orphan, chainFromUnits(orphan), undefined)).toBe('Waiting on you — see Needs you · 0 of 1 done');
    expect(nowStep(chain, orphan.units, null, 'held')).toMatchObject({ index: 0, kind: 'wait', word: 'waiting on you' });
  });

  it('the repositories: a held run is waiting, not working now, and counts with the gates', () => {
    const acme: RepoEntry = { id: 'acme', name: 'acme', root_path: '/tmp/acme', default_branch: 'main', registered_at: 1_700_000_000 };
    const fold = () => repoFleetModels([acme], [orphan], {}, new Set([ORPHAN]))[0]!;
    expect(fold()).toMatchObject({ activeNow: true, counts: { active: 1, gates: 0 } });
    expect(fold().waiting).toHaveLength(0);
    useHeldRuns.getState().setHeld(new Set([ORPHAN]));
    expect(fold()).toMatchObject({ activeNow: false, counts: { active: 0, gates: 1 } });
    expect(fold().waiting.map((v) => v.session.id)).toEqual([ORPHAN]);
    expect(statusCounts([orphan])).toMatchObject({ active: 0, gates: 1 });
    expect(statusWord(orphan)).toEqual({ word: 'Waiting on you', tone: 'gate' });
  });
});
