// wicked-studio#250 / F-3R2-018 — the landing's delivery fold counts a run "vacuous" only when it
// was EXPECTED to deliver. On the Phase 3 rig the strip read "2 Verified & delivered · 0 Stranded
// — needs review · 9 Vacuous — needs retry": the nine were `onboarding` runs, which deliver
// nothing by design. The fold now takes the app's `is_system` lookup and licenses the vacuous
// bucket with the SAME rule the Delivery section uses (`canDeliver`: a deliver unit on the run,
// or a workflow positively known not to be a system one) — one spelling, and it can only ever
// WITHHOLD a count, never invent one.

import { describe, expect, it } from 'vitest';
import type { WorkflowDef } from '../src/api/types.js';
import { deliveryCounts } from '../src/board/windowStats.js';
import { isSystemWorkflowIn } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS, materialised } from './fixtures/workflows.js';

const lookupOver = (defs: WorkflowDef[] | null) => (id: string) => isSystemWorkflowIn(defs, id);
const warm = lookupOver(LIVE_WORKFLOWS);
const cold = lookupOver(null);

/** A repo-scoped run the daemon stamped `vacuous`, on the given workflow, with/without a deliver unit. */
function vacuousRun(id: string, workflow_id: string, withDeliverUnit: boolean) {
  return makeView(
    { id, workflow_id, status: 'completed', repo_ref: 'org/repo', delivery: 'vacuous' },
    withDeliverUnit
      ? [makeUnit({ id: `${id}:deliver`, session_id: id, ord: 5, status: 'rejected', denial_reason: 'nothing to deliver' })]
      : [],
  );
}

describe('deliveryCounts — the vacuous licence (F-3R2-018)', () => {
  it('the recorded case: nine onboarding runs stamped vacuous do NOT count — warm or cold cache', () => {
    const runs = [
      ...Array.from({ length: 9 }, (_, i) => vacuousRun(`ob-${i}`, 'onboarding', false)),
      makeView({ id: 'd1', delivery: 'delivered' }),
      makeView({ id: 'd2', delivery: 'delivered' }),
    ];
    expect(deliveryCounts(runs, warm)).toEqual({ delivered: 2, stranded: 0, vacuous: 0 });
    // `onboarding` is on the denylist too, so the answer holds before the catalog has loaded.
    expect(deliveryCounts(runs, cold)).toEqual({ delivered: 2, stranded: 0, vacuous: 0 });
    expect(deliveryCounts(runs)).toEqual({ delivered: 2, stranded: 0, vacuous: 0 });
  });

  it('a run WITH a deliver unit that produced nothing counts vacuous whatever its workflow id says (evidence first)', () => {
    // A materialised per-run def is in no catalog — the lookup answers undefined — but the run's
    // own units show the deliver phase ran and was denied for having nothing to lift.
    const run = vacuousRun('r1', materialised('r1'), true);
    expect(deliveryCounts([run], warm).vacuous).toBe(1);
    expect(deliveryCounts([run], cold).vacuous).toBe(1);
    expect(deliveryCounts([run]).vacuous).toBe(1);
  });

  it('a run on a POSITIVELY KNOWN build workflow (def in hand, no is_system flag) counts vacuous without a deliver unit', () => {
    // `bug` launched with `deliver: 'none'` — it could have delivered and chose not to; it still
    // completed with no change, which is the real vacuous signal.
    const run = vacuousRun('b1', 'bug', false);
    expect(deliveryCounts([run], warm).vacuous).toBe(1);
  });

  it('withholds when the classification is unknown: no deliver unit + a def the catalog does not serve, or no lookup at all', () => {
    const run = vacuousRun('m1', materialised('m1'), false);
    expect(deliveryCounts([run], warm).vacuous).toBe(0);
    expect(deliveryCounts([run], cold).vacuous).toBe(0);
    expect(deliveryCounts([run]).vacuous).toBe(0);
    // A build id with a COLD cache is `undefined`, not `false` — still withheld (the same trade the
    // Delivery section makes; the count appears when the one GET /workflows lands).
    expect(deliveryCounts([vacuousRun('b2', 'bug', false)], cold).vacuous).toBe(0);
  });

  it('every other system workflow the catalog flags is excluded the same way (collab, interactive-*)', () => {
    const runs = ['collab', 'interactive-draft', 'survey-repo', 'chat'].map((wf, i) => vacuousRun(`s-${i}`, wf, false));
    expect(deliveryCounts(runs, warm).vacuous).toBe(0);
  });

  it('delivered and stranded are untouched by the licence, and archived runs stay excluded', () => {
    const runs = [
      makeView({ id: 'a', workflow_id: 'onboarding', delivery: 'delivered' }),
      makeView({ id: 'b', workflow_id: 'onboarding', delivery: 'stranded' }),
      makeView({ id: 'c', workflow_id: 'onboarding', delivery: 'none' }),
      makeView({ id: 'd', workflow_id: 'bug', delivery: 'vacuous', archived_at: 1 }),
      vacuousRun('e', 'bug', true),
    ];
    expect(deliveryCounts(runs, warm)).toEqual({ delivered: 1, stranded: 1, vacuous: 1 });
  });
});
