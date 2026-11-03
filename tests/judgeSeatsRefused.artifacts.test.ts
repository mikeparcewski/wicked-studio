import { describe, expect, it } from 'vitest';
import type { RosterSeat, SessionView } from '../src/api/types.js';
import { judgeSeats } from '../src/board/gateHeadline.js';

// artifact-runs-fix (rig run 968e8c7c): the gate led with "Approve and retry with Claude Code" and the reassign
// answered 409 — "that seat authored the work … authors: codex, claude" (claude's attempt on the build step was
// reassigned to codex). Crew serves the engine's refused set on the unit (`reassign_refused`); the lead, the
// headline and the in-job candidate must never name a seat in it.
const roster = ['claude', 'codex', 'pi'].map((key) => ({ key, display_name: key, signed_in: true })) as unknown as RosterSeat[];
const view = (refused: string[] | undefined) => ({
  session: { id: 'run-968', status: 'awaiting_human', clis: ['claude', 'codex'] },
  units: [
    { ord: 1, stage: 'recon', role: 'neutral', assigned_cli: 'claude', status: 'done' },
    { ord: 2, stage: 'build', role: 'creator', assigned_cli: 'codex', authored_by: ['claude', 'codex'], status: 'done' },
    { ord: 3, stage: 'review', role: 'evaluator', assigned_cli: 'codex', status: 'distributed', ...(refused !== undefined ? { reassign_refused: refused } : {}) },
  ],
}) as unknown as SessionView;
const prompt = 'unit 3 checks work built on `codex` and ran on that same seat; the run requires a distinct evaluator';

describe('judgeSeats never offers a seat the engine refuses', () => {
  it('a refused seat in the job is a builder, not the in-job reviewer; a signed-in helper outside is offered instead', () => {
    const j = judgeSeats(view(['claude', 'codex']), 3, prompt, ['claude', 'codex'], roster);
    expect(j.builders).toContain('claude');
    expect(j.inJob).toBeUndefined();
    expect(j.outside?.key).toBe('pi');
  });
  it('without a refused set the engine-side rule is not guessed here (crew serves it; studio ships with that crew)', () => {
    expect(judgeSeats(view(undefined), 3, prompt, ['claude', 'codex'], roster).inJob?.cli).toBe('claude');
  });
});
