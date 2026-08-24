import { describe, it, expect } from 'vitest';
import {
  currentUnitOf,
  leadMovingRun,
  phaseLineOf,
  phaseNodesOf,
  truncate,
} from '../src/board/phaseProgress.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import type { WorkUnit } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The slice-BA CLIENT derivation (DES-UX-002 §1.2): phase progress over the
 * unit plan the board already holds, with the live `unitDispatched` wire on
 * top. Pure functions — every verdict here is pinned with no React and no
 * clock.
 */

/** The §1.5 fixture plan: 5 ordered units, 2 done, 1 active, 2 pending —
 *  5 nodes because a return-to-build leg IS a distinct leg of the plan
 *  (StageKind has only 4 values; the wire cannot spell 5 distinct stages). */
const PLAN: WorkUnit[] = [
  makeUnit({ id: 'r:u0', ord: 0, stage: 'recon', status: 'done', description: 'survey the surface' }),
  makeUnit({ id: 'r:u1', ord: 1, stage: 'build', status: 'done', description: 'wire the endpoint' }),
  makeUnit({ id: 'r:u2', ord: 2, stage: 'review', status: 'distributed', description: 'review the middleware refactor' }),
  makeUnit({ id: 'r:u3', ord: 3, stage: 'build', status: 'pending', description: 'apply the review fixes' }),
  makeUnit({ id: 'r:u4', ord: 4, stage: 'test', status: 'pending', description: 'run the acceptance suite' }),
];

const logged = (type: string, ord: number, seq = 1): LoggedEvent => ({ seq, type, ord, ts: 0, detail: '' });

describe('truncate — the §1.3 one-line cap, honestly elided', () => {
  it('passes a short description through untouched', () => {
    expect(truncate('wire the board', 60)).toBe('wire the board');
  });

  it('caps at the limit INCLUDING the ellipsis — never cap+1 chars', () => {
    const long = 'x'.repeat(80);
    expect(truncate(long, 60)).toHaveLength(60);
    expect(truncate(long, 60).endsWith('…')).toBe(true);
  });
});

describe('currentUnitOf — §1.2 rule order (live dispatch → distributed → pending-after-done)', () => {
  it('no log: the distributed unit is the current one', () => {
    expect(currentUnitOf(PLAN)?.ord).toBe(2);
  });

  it('the newest unitDispatched in the live log wins over the (stale) unit list', () => {
    const log = [logged('unitDispatched', 2, 1), logged('unitDispatched', 3, 2)];
    expect(currentUnitOf(PLAN, log)?.ord).toBe(3);
  });

  it('a dispatch whose unit the fresher list already shows terminal yields to the list', () => {
    const log = [logged('unitDispatched', 1, 1)]; // u1 is done — stale frame
    expect(currentUnitOf(PLAN, log)?.ord).toBe(2);
  });

  it('non-dispatch frames in the log are not position claims', () => {
    const log = [logged('unitOutputCaptured', 4, 1)];
    expect(currentUnitOf(PLAN, log)?.ord).toBe(2);
  });

  it('no distributed unit: the lowest-ord pending after the last done', () => {
    const plan = [
      makeUnit({ id: 'r:u0', ord: 0, stage: 'recon', status: 'done' }),
      makeUnit({ id: 'r:u1', ord: 1, stage: 'build', status: 'pending' }),
      makeUnit({ id: 'r:u2', ord: 2, stage: 'test', status: 'pending' }),
    ];
    expect(currentUnitOf(plan)?.ord).toBe(1);
  });

  it('an all-done plan has NO current unit — the strip never states a false position', () => {
    const plan = PLAN.map((u) => ({ ...u, status: 'done' as const }));
    expect(currentUnitOf(plan)).toBeUndefined();
  });

  it('an empty plan has no current unit', () => {
    expect(currentUnitOf([])).toBeUndefined();
  });
});

describe('phaseNodesOf — consecutive same-stage legs, §1.3 grouping', () => {
  it('the §1.5 fixture plan yields 5 nodes: 2 complete, 1 active, 2 future', () => {
    const nodes = phaseNodesOf(PLAN, 2);
    expect(nodes.map((n) => n.stage)).toEqual(['recon', 'build', 'review', 'build', 'test']);
    expect(nodes.map((n) => n.state)).toEqual(['complete', 'complete', 'active', 'future', 'future']);
  });

  it('consecutive same-stage units fold into ONE node spanning their ords', () => {
    const plan = [
      makeUnit({ id: 'r:u0', ord: 0, stage: 'recon', status: 'done' }),
      makeUnit({ id: 'r:u1', ord: 1, stage: 'build', status: 'done' }),
      makeUnit({ id: 'r:u2', ord: 2, stage: 'build', status: 'distributed' }),
    ];
    const nodes = phaseNodesOf(plan, 2);
    expect(nodes).toHaveLength(2);
    expect(nodes[1]?.ords).toEqual([1, 2]);
    // The leg holding the current unit is ACTIVE even though a sibling is done.
    expect(nodes[1]?.state).toBe('active');
  });

  it('no current ord: nodes are complete or future, none active', () => {
    const nodes = phaseNodesOf(PLAN, undefined);
    expect(nodes.some((n) => n.state === 'active')).toBe(false);
    expect(nodes[0]?.state).toBe('complete');
    expect(nodes[2]?.state).toBe('future'); // distributed ≠ every-unit-done
  });

  it('units arrive unsorted: nodes group in ord order regardless', () => {
    const nodes = phaseNodesOf([...PLAN].reverse(), 2);
    expect(nodes.map((n) => n.stage)).toEqual(['recon', 'build', 'review', 'build', 'test']);
  });
});

describe('phaseLineOf — the sidebar line, never a position it does not hold', () => {
  it('spells phase n/N · stage-name off the active node', () => {
    expect(phaseLineOf(phaseNodesOf(PLAN, 2))).toBe('phase 3/5 · review');
  });

  it('is null with no active node (no plan, or a terminal run)', () => {
    expect(phaseLineOf(phaseNodesOf(PLAN, undefined))).toBeNull();
    expect(phaseLineOf([])).toBeNull();
  });
});

describe('leadMovingRun — whose plan the card strip shows', () => {
  it('picks the first run moving under its own power; terminal and gated runs never lead', () => {
    const gated = makeView({ id: 'r-gate', status: 'awaiting_human' });
    const done = makeView({ id: 'r-done', status: 'completed' });
    const live = makeView({ id: 'r-live', status: 'executing' });
    expect(leadMovingRun([gated, done, live])?.session.id).toBe('r-live');
    expect(leadMovingRun([gated, done])).toBeUndefined();
  });
});
