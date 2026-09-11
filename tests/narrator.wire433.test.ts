// wicked-core#431 / api-types 0.33.0 in the FEED (DES-RUN-NARRATOR §4): the run base, the creator
// tree restored, the deliver lift per outcome, a refused write, and the ONE deliberate ACP reroute
// the feed speaks (`read_only_requires_wrapped`) — every other acpFallback kind stays silent, as
// do the frames a pre-0.33.0 daemon never sends.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { narrate, type NarratorContext } from '../src/components/narrator.js';
import {
  BASE_AFTER,
  BASE_BEFORE,
  LIFT_CONFLICT,
  LIFT_FAILED,
  LIFT_LIFTED,
  LIFT_SKIPPED,
  LIFT_UNCHANGED,
  READ_ONLY_REROUTE,
  RUN_BASE_LIFTED,
  RUN_BASE_NO_REMOTE,
  SUGGESTION_REF,
  TOOL_DENIED,
  TOOL_DENIED_KINDLESS,
  WORKTREE_RESTORED,
} from './fixtures/wire433.js';

const ctx: NarratorContext = {
  phaseOf: (ord) => (typeof ord === 'number' ? `phase-${ord}` : 'this phase'),
};

describe('narrate — the wicked-core#431 frames', () => {
  const CASES: Array<[CoreEvent, string, string]> = [
    [RUN_BASE_LIFTED, `Based on origin/main @ ${BASE_AFTER.slice(0, 7)} · 5 behind · lifted to the tip`, 'info'],
    [RUN_BASE_NO_REMOTE, `Based on local HEAD @ ${BASE_BEFORE.slice(0, 7)} · no remote default branch resolved`, 'info'],
    [WORKTREE_RESTORED, `Restored the creator's tree for phase-4 — pi's edit (1 path) was discarded, kept at ${SUGGESTION_REF}`, 'gate'],
    [{ ...WORKTREE_RESTORED, suggestionRef: null, discarded: [] }, "Restored the creator's tree for phase-4 — pi's edit (0 paths) was discarded", 'gate'],
    [LIFT_UNCHANGED, `Deliver lift: base unchanged — origin/main is still at ${BASE_BEFORE.slice(0, 7)}`, 'info'],
    [LIFT_LIFTED, `Deliver lift: lifted onto origin/main @ ${BASE_AFTER.slice(0, 7)} — re-running the repository's checks on the lifted tree`, 'work'],
    [LIFT_CONFLICT, 'Deliver lift: CONFLICT in testid-inventory.json — nothing rebased, nothing pushed', 'fail'],
    [LIFT_SKIPPED, 'Deliver lift: skipped — no remote default branch resolved (origin/HEAD is unset and origin/main does not exist)', 'info'],
    [LIFT_FAILED, 'Deliver lift: FAILED — git read-tree -m -u exited 128 after the merge-tree succeeded — nothing pushed', 'fail'],
    [{ ...LIFT_UNCHANGED, outcome: 'rebased_by_operator', note: 'by hand' }, 'Deliver lift: rebased_by_operator — by hand', 'info'],
    [TOOL_DENIED, 'Refused a write by claude during phase-4 — edit on src/App.tsx (a read-only phase may not edit)', 'fail'],
    [TOOL_DENIED_KINDLESS, 'Refused a write by claude during phase-4 — edit (a read-only phase may not edit)', 'fail'],
    [READ_ONLY_REROUTE, 'pi moved to the wrapped carrier for its read-only turn — the write lock is an argv fact there, not a failure', 'info'],
  ];

  for (const [event, text, tone] of CASES) {
    it(`${event.type}${typeof event['outcome'] === 'string' ? `/${event['outcome']}` : ''} → "${text.slice(0, 48)}…" (${tone})`, () => {
      const line = narrate(event, ctx);
      expect(line).not.toBeNull();
      expect(line!.text).toBe(text);
      expect(line!.tone).toBe(tone);
      expect(line!.event).toBe(event);
    });
  }

  it('every other acpFallback kind stays silent — a transport failure is seat-health\'s story, not a feed line', () => {
    for (const kind of ['binary_unavailable', 'session_died', 'auth_required', 'governance_requires_wrapped', 'something_newer']) {
      expect(narrate({ ...READ_ONLY_REROUTE, fallbackKind: kind }, ctx)).toBeNull();
    }
  });

  it('a runBaseResolved frame with no commit is not spoken (nothing to base the line on)', () => {
    expect(narrate({ type: 'runBaseResolved', session: 'r' }, ctx)).toBeNull();
  });

  it('the deliver lift line carries the deliver ord so the feed anchors it under the deliver unit', () => {
    expect(narrate(LIFT_CONFLICT, ctx)!.ord).toBe(5);
    expect(narrate(RUN_BASE_LIFTED, ctx)!.ord).toBeNull(); // session-level: no ord
  });
});
