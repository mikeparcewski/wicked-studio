import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { canDeliver, deliverySummary } from '../src/components/delivery.js';
import { deliverKindOf, runKindOf, SYSTEM_WORKFLOW_IDS, type RunKind } from '../src/components/runMode.js';
import {
  clearCachedWorkflows,
  fetchWorkflowsCached,
  getCachedWorkflows,
  isSystemWorkflowIn,
  setCachedWorkflows,
  subscribeWorkflows,
} from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { BUILD_IDS, DENYLIST_BLIND_SPOT, LIVE_WORKFLOWS, SYSTEM_IDS } from './fixtures/workflows.js';

/**
 * `deliverKindOf` — the ONE run-kind predicate (wicked-studio#122 D-1).
 *
 * The defect, in one line: `SYSTEM_WORKFLOW_IDS` names FIVE of the daemon's
 * ELEVEN system workflows, so `canDeliver` classified `collab` and all five
 * `interactive-*` — the document and video seams — as build work, and the rail
 * offered them a remedy ("launch with deliver: pr") that studio's own composer
 * refuses. This table is the whole live `GET /workflows` payload, so a
 * workflow the daemon flags can never again be build work to one half of the app.
 */

/** The authoritative lookup, as the app's workflow cache serves it. */
const KNOWN = (id: string): boolean | undefined => isSystemWorkflowIn(LIVE_WORKFLOWS, id);

const viewOf = (workflow_id: string | null) => {
  const v = makeView({ id: 'run-1' }, [makeUnit({ id: 'run-1:build', status: 'done' })]);
  return { ...v, session: { ...v.session, workflow_id } as typeof v.session };
};

describe('the ELEVEN real is_system ids all classify system', () => {
  for (const id of SYSTEM_IDS) {
    it(`${id} → system, and cannot deliver`, () => {
      expect(deliverKindOf(id, KNOWN)).toBe<RunKind>('system');
      expect(canDeliver(viewOf(id), KNOWN)).toBe(false);
    });
  }

  it('the six the denylist never knew: build BEFORE the fix, system after', () => {
    for (const id of DENYLIST_BLIND_SPOT) {
      // The defect, pinned: the denylist alone — which is exactly what
      // `canDeliver` used to consult — calls every one of these build work.
      expect(SYSTEM_WORKFLOW_IDS.has(id), `${id} is not on the denylist`).toBe(false);
      expect(runKindOf(id)).toBe<RunKind>('build');
      // The fix: the daemon's own flag wins.
      expect(deliverKindOf(id, KNOWN), `${id} must be system`).toBe<RunKind>('system');
    }
    expect(DENYLIST_BLIND_SPOT).toHaveLength(6);
  });
});

describe('the six NON-system ids stay build', () => {
  for (const id of BUILD_IDS) {
    it(`${id} → build, and can deliver`, () => {
      // These defs carry NO `is_system` key at all on the live wire — presence
      // in the list, not the flag's value, is the positive answer.
      expect(LIVE_WORKFLOWS.find((w) => w.id === id)?.is_system).toBeUndefined();
      expect(KNOWN(id)).toBe(false);
      expect(deliverKindOf(id, KNOWN)).toBe<RunKind>('build');
      expect(canDeliver(viewOf(id), KNOWN)).toBe(true);
    });
  }
});

describe('the denylist survives as a FALLBACK, and the rule stays one-directional', () => {
  it('with NO lookup, every id falls back to the denylist verdict verbatim', () => {
    for (const id of [...SYSTEM_IDS, ...BUILD_IDS]) {
      expect(deliverKindOf(id)).toBe(runKindOf(id));
    }
  });

  it('an unknown def never PROMOTES a denylisted id to build', () => {
    // The one-directional guarantee studio#124 wrote and this refactor inherits:
    // the flag may only ever withhold delivery. A def that is absent, or that
    // positively says `is_system: false`, cannot overturn the denylist.
    expect(deliverKindOf('chat', () => undefined)).toBe<RunKind>('system');
    expect(deliverKindOf('chat', () => false)).toBe<RunKind>('system');
    expect(deliverKindOf('memories', () => false)).toBe<RunKind>('system');
  });

  it('an unknown def leaves a pre-flag workflow deliverable — degrading, not guessing', () => {
    expect(deliverKindOf('some-workflow-shipped-tomorrow', () => undefined)).toBe<RunKind>('build');
    expect(deliverKindOf('some-workflow-shipped-tomorrow', KNOWN)).toBe<RunKind>('build');
  });

  it('no workflow at all is freeform, lookup or not — deliver without workflow is a 400', () => {
    for (const id of ['', '   ', null, undefined]) {
      expect(deliverKindOf(id, KNOWN)).toBe<RunKind>('freeform');
      expect(deliverKindOf(id, () => false)).toBe<RunKind>('freeform');
    }
    expect(canDeliver(viewOf(null), KNOWN)).toBe(false);
  });
});

describe('the census stops counting document and video threads (D5, re-opened by D-1)', () => {
  /** A run on `id` whose deliver phase never existed. */
  const plain = (id: string, workflow_id: string) =>
    makeView({ id, workflow_id }, [makeUnit({ id: `${id}:build`, session_id: id, status: 'done' })]);
  /** A build run that ran its deliver phase. */
  const delivered = (id: string) =>
    makeView({ id, workflow_id: 'feature' }, [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'done' }),
    ]);

  const runs = [
    delivered('r-1'), delivered('r-2'),
    ...DENYLIST_BLIND_SPOT.map((wf, i) => plain(`i-${i}`, wf)),
  ];

  it('with the lookup they are out of the census entirely', () => {
    expect(deliverySummary(runs, KNOWN)).toBe('2 ran deliver');
  });

  it('and without it they are out for the OTHER reason — nothing proves they could deliver', () => {
    // The reported symptom was "2 ran deliver · 6 no deliver phase": the six
    // read as build work because the denylist does not know them. The flag is
    // one half of the answer and the licence is the other — the "no deliver
    // phase" bucket counts a run only when a def IN HAND says the workflow is
    // ordinary, so an unproven id is never counted whichever way it would have
    // classified. The delivering runs need no licence: they have a deliver unit.
    expect(deliverySummary(runs)).toBe('2 ran deliver');
    for (const id of DENYLIST_BLIND_SPOT) expect(runKindOf(id)).toBe<RunKind>('build');
  });
});

describe('the shared workflow cache: ONE GET for the app, degrading silently', () => {
  beforeEach(() => {
    clearCachedWorkflows();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    clearCachedWorkflows();
  });

  it('N callers, ONE request — in-flight-deduped, then served from cache', async () => {
    let resolve!: (v: { workflows: typeof LIVE_WORKFLOWS }) => void;
    const spy = vi.spyOn(client.api, 'listWorkflows').mockReturnValue(
      new Promise((r) => { resolve = r; }),
    );

    for (let i = 0; i < 50; i += 1) fetchWorkflowsCached();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getCachedWorkflows()).toBeNull();

    resolve({ workflows: LIVE_WORKFLOWS });
    await vi.waitFor(() => expect(getCachedWorkflows()).toHaveLength(17));

    for (let i = 0; i < 50; i += 1) fetchWorkflowsCached();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch caches the degraded answer — asked once per session, never retried', async () => {
    const spy = vi.spyOn(client.api, 'listWorkflows').mockRejectedValue(new Error('route absent'));
    fetchWorkflowsCached();
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    fetchWorkflowsCached();
    fetchWorkflowsCached();
    expect(spy).toHaveBeenCalledTimes(1);
    // Still UNKNOWN, never "not a system workflow" — the safe direction.
    expect(getCachedWorkflows()).toBeNull();
    expect(isSystemWorkflowIn(getCachedWorkflows(), 'interactive-draft')).toBeUndefined();
  });

  it('an api surface with no listWorkflows at all does not throw into the render', () => {
    vi.spyOn(client.api, 'listWorkflows').mockImplementation(() => {
      throw new TypeError('api.listWorkflows is not a function');
    });
    expect(() => fetchWorkflowsCached()).not.toThrow();
    expect(getCachedWorkflows()).toBeNull();
  });

  it('a deposit from a surface that already fetched satisfies the app', () => {
    const spy = vi.spyOn(client.api, 'listWorkflows');
    const seen: number[] = [];
    const unsub = subscribeWorkflows(() => seen.push(getCachedWorkflows()?.length ?? 0));

    setCachedWorkflows(LIVE_WORKFLOWS);
    expect(seen).toStrictEqual([17]);

    fetchWorkflowsCached();
    expect(spy).not.toHaveBeenCalled();
    unsub();
  });
});
