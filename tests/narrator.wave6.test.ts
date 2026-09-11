// The wave-6 wire (api-types 0.36.0) in the FEED (DES-RUN-NARRATOR §4): a degraded council said
// on the routing line, a gate the engine calls UNGATED said as UNGATED (never "Checks ran — pass"
// alone), the remote-write fence with its remedy, and the camelCase `agreementPct` the engine
// actually emits — with the snake_case 0.34.0 spelling still read as the fallback until the pin.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { narrate, type NarratorContext } from '../src/components/narrator.js';
import {
  GATE_JUDGED_PASS,
  GATE_UNGATED_NO_FLOOR,
  GATE_UNGATED_WITH_FLOOR,
  UNIT_DISTRIBUTED_DEGRADED,
  UNIT_DISTRIBUTED_FULL,
  UNIT_DISTRIBUTED_SNAKE,
  W6_DEGRADED_REASON,
  W6_REFUSED_COMMAND,
  W6_REMEDY,
  WORKER_TOOL_DENIED,
  WORKER_TOOL_DENIED_NO_REMEDY,
} from './fixtures/wave6.js';

const ctx: NarratorContext = {
  phaseOf: (ord) => (typeof ord === 'number' ? `phase-${ord}` : 'this phase'),
};

const ev = (e: unknown): CoreEvent => e as CoreEvent;

describe('unitDistributed — the camelCase spelling, and the degraded council', () => {
  it('reads `agreementPct` as the engine emits it (0.34.0 declared `agreement_pct`, which the wire never carried)', () => {
    const line = narrate(ev(UNIT_DISTRIBUTED_FULL), ctx)!;
    expect(line.text).toBe('phase-1 routed to claude — council 80%');
    expect(line.tone).toBe('info');
  });

  it('a `degradedReason` is said on the routing line, in the gate tone — one seat agreeing with itself is not a council', () => {
    const line = narrate(ev(UNIT_DISTRIBUTED_DEGRADED), ctx)!;
    expect(line.text).toBe(`phase-2 routed to claude — council 100% — council degraded: ${W6_DEGRADED_REASON}`);
    expect(line.tone).toBe('gate');
    expect(line.ord).toBe(2);
  });

  it('the 0.34.0 snake_case spelling is still read as the fallback (TODO drop at the 0.36.0 pin)', () => {
    const line = narrate(ev(UNIT_DISTRIBUTED_SNAKE), ctx)!;
    expect(line.text).toBe('phase-2 routed to claude — council 67% — council degraded: 2 of 5 seats benched: codex, pi (signed out)');
  });

  it('camelCase wins when both spellings are present', () => {
    const line = narrate(ev({ ...UNIT_DISTRIBUTED_SNAKE, agreementPct: 100, degradedReason: null }), ctx)!;
    expect(line.text).toBe('phase-2 routed to claude — council 100%');
    expect(line.tone).toBe('info');
  });
});

describe('gateEvaluated — UNGATED is said as UNGATED (F-7R2-005 / F-7R2-017)', () => {
  it('a floor ran but the engine says no judge could be convened ⇒ "Gate UNGATED … repository checks ran, no distinct judge" — never "Checks ran — pass"', () => {
    const line = narrate(ev(GATE_UNGATED_WITH_FLOOR), ctx)!;
    expect(line.text).toBe('Gate UNGATED on phase-2 — no eligible judge seat; repository checks ran, no distinct judge');
    expect(line.tone).toBe('gate');
    expect(line.text).not.toMatch(/Checks ran/);
  });

  it('no floor and no judge ⇒ "… no repository checks ran"', () => {
    const line = narrate(ev(GATE_UNGATED_NO_FLOOR), ctx)!;
    expect(line.text).toBe('Gate UNGATED on phase-4 — no eligible judge seat; no repository checks ran');
    expect(line.tone).toBe('gate');
  });

  it('`ungated: true` with no reason still says UNGATED, with the neutral cause', () => {
    const line = narrate(ev({ ...GATE_UNGATED_NO_FLOOR, ungatedReason: null }), ctx)!;
    expect(line.text).toBe('Gate UNGATED on phase-4 — no judge convened; no repository checks ran');
  });

  it('a judged pass on the same wire keeps the #261 wording — the floor ran, so "Checks ran … — pass" is true', () => {
    const line = narrate(ev(GATE_JUDGED_PASS), ctx)!;
    expect(line.text).toBe('Checks ran on phase-4 — pass');
    expect(line.tone).toBe('work');
  });

  it('F-5: a floor-only pass whose frame SAYS `judgeCli: null` (the single-seat rig) appends "— no distinct judge"; a pre-0.33 frame without the key claims nothing', () => {
    const floorOnly = { ...GATE_UNGATED_WITH_FLOOR, ungated: false, ungatedReason: null }; // judgeCli: null present
    expect(narrate(ev(floorOnly), ctx)!.text).toBe('Checks ran on phase-2 — pass — no distinct judge');
    const { judgeCli: _j, judgeDistinct: _d, ...older } = floorOnly;
    void _j; void _d;
    expect(narrate(ev(older), ctx)!.text).toBe('Checks ran on phase-2 — pass');
  });

  it('a denial is a denial even when the frame also says ungated', () => {
    const line = narrate(ev({ ...GATE_UNGATED_WITH_FLOOR, combined: false, denialReason: 'typecheck exit 2' }), ctx)!;
    expect(line.text).toBe('Checks ran on phase-2 — deny: typecheck exit 2');
    expect(line.tone).toBe('fail');
  });

  it('a pre-0.36 frame (no `ungated` key) keeps the fold\'s own wording', () => {
    const { ungated: _u, ungatedReason: _r, ...older } = GATE_UNGATED_NO_FLOOR;
    void _u; void _r;
    expect(narrate(ev(older), ctx)!.text).toBe('Gate passed without checks on phase-4 (ungated)');
  });
});

describe('workerToolCallDenied — the remote-write fence (F-7R2-012)', () => {
  it('names the seat, its role, the refused command as code, and the engine\'s remedy', () => {
    const line = narrate(ev(WORKER_TOOL_DENIED), ctx)!;
    expect(line.text).toBe(`Refused a remote write by claude (creator) during phase-2 — Bash: \`${W6_REFUSED_COMMAND}\` — ${W6_REMEDY}`);
    expect(line.tone).toBe('fail');
    expect(line.ord).toBe(2);
  });

  it('a frame with no remedy gets the platform\'s own sentence — never a bare refusal', () => {
    const line = narrate(ev(WORKER_TOOL_DENIED_NO_REMEDY), ctx)!;
    expect(line.text).toBe("Refused a remote write by claude (creator) during phase-2 — Bash: `git push origin HEAD` — delivery is performed by the run's deliver phase");
  });

  it('a very long command is clipped to one line, the remedy still rides', () => {
    const long = `gh api repos/o/r/pulls -f title=${'x'.repeat(200)}`;
    const line = narrate(ev({ ...WORKER_TOOL_DENIED, command: long }), ctx)!;
    expect(line.text.length).toBeLessThan(220);
    expect(line.text.endsWith(`— ${W6_REMEDY}`)).toBe(true);
  });
});
