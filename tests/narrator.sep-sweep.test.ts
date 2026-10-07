// #405: no narrated line — for ANY recorded event fixture, or a unitPlanned frame carrying the
// engine's ` ||| ` instruction separator — ever contains the raw marker. The fixture modules are
// swept wholesale (every exported CoreEvent, and every CoreEvent inside an exported array), so a
// new fixture joins the sweep without being listed here.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { INSTRUCTION_SEP } from '../src/components/gateMoveModel.js';
import { narrate, type NarratorContext } from '../src/components/narrator.js';
import * as wave6 from './fixtures/wave6.js';
import * as wire433 from './fixtures/wire433.js';

const ctx: NarratorContext = {
  phaseOf: (ord) => (typeof ord === 'number' ? `phase-${ord}` : 'this phase'),
  intent: 'Implement GitHub issue #405 in this repo',
};

function isEvent(v: unknown): v is CoreEvent {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string';
}

function eventsOf(mod: Record<string, unknown>): CoreEvent[] {
  const out: CoreEvent[] = [];
  for (const v of Object.values(mod)) {
    if (isEvent(v)) out.push(v);
    else if (Array.isArray(v)) for (const x of v) if (isEvent(x)) out.push(x);
  }
  return out;
}

describe('narrate — the ` ||| ` separator never reaches a line (#405)', () => {
  const fixtures = [...eventsOf(wire433 as Record<string, unknown>), ...eventsOf(wave6 as Record<string, unknown>)];
  // The engine writes "<phase> — <intent> ||| <instructions>" on every planned unit of a workflow;
  // the recorded fixtures carry the clean shape, so the sweep adds the separator form for each
  // fixture ord as well.
  const planned: CoreEvent[] = [
    { type: 'unitPlanned', session: 'r', ord: 1, description: `phase-1 — survey the repo${INSTRUCTION_SEP}Read every file under src/.` },
    { type: 'unitPlanned', session: 'r', ord: 2, description: `phase-2 — ${ctx.intent}${INSTRUCTION_SEP}Design it.${INSTRUCTION_SEP}APPROVED INTENT AMENDMENT — more.` },
    { type: 'unitPlanned', session: 'r', ord: 3, description: `pa-scope — scope it${INSTRUCTION_SEP}Scope the ask.` },
  ];

  it('sweeps every recorded fixture frame', () => {
    expect(fixtures.length).toBeGreaterThan(10);
    const offenders = fixtures
      .map((e) => narrate(e, ctx))
      .filter((l): l is NonNullable<typeof l> => l !== null && l.text.includes('|||'))
      .map((l) => l.text);
    expect(offenders).toEqual([]);
  });

  it('sweeps unitPlanned frames that carry the separator', () => {
    for (const e of planned) {
      const line = narrate(e, ctx);
      expect(line).not.toBeNull();
      expect(line!.text).not.toContain('|||');
    }
    expect(narrate(planned[0]!, ctx)!.text).toBe('Planned phase-1 — survey the repo');
    expect(narrate(planned[1]!, ctx)!.text).toBe('Planned phase-2');
    expect(narrate(planned[2]!, ctx)!.text).toBe('Planned phase-3 — pa-scope — scope it');
  });
});
