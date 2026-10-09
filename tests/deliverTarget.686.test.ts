/**
 * core#686 (studio half): the deliver consent line reads `WorkUnit.instructions` / `amendments`
 * (api-types 0.100.1) when the unit is `structured_description`, and never splits the description.
 * Legacy records keep the old split.
 */
import { describe, expect, it } from 'vitest';
import type { WorkUnit } from '../src/api/types.js';
import { deliverTargetOf, unitAmendmentsOf } from '../src/components/gateMoveModel.js';
import { makeUnit } from './factories.js';

const CARD = 'Pushes the run branch wicked/r1 to origin (github.com/acme/shop) and opens a pull request there. Push identity: gh login.';
const TARGET = 'Pushes the run branch wicked/r1 to origin (github.com/acme/shop) and opens a pull request there.';

function deliver(over: Partial<WorkUnit>): WorkUnit[] {
  return [makeUnit({ id: 'r1:deliver', session_id: 'r1', ord: 3, phase_ref: 'deliver', ...over })];
}

describe('core#686 — the card from the fields', () => {
  it('mis-parse 1: an intent quoting the amendment sentence still yields the card', () => {
    const units = deliver({
      description: `deliver — fix the APPROVED INTENT AMENDMENT banner text ||| APPROVED INTENT AMENDMENT (gate 2): also fix the footer ||| ${CARD} ||| APPROVED INTENT AMENDMENT (gate 4): keep the old copy`,
      instructions: CARD,
      amendments: ['also fix the footer', 'keep the old copy'],
      structured_description: true,
    });
    expect(deliverTargetOf(units, 3)).toBe(TARGET);
    expect(unitAmendmentsOf(units, 3)).toEqual(['also fix the footer', 'keep the old copy']);
  });

  it('mis-parse 2: a card-less phase whose intent contains " ||| " claims no card', () => {
    const units = deliver({ description: 'deliver — split on a ||| b in the parser', structured_description: true });
    expect(deliverTargetOf(units, 3)).toBeNull();
    expect(unitAmendmentsOf(units, 3)).toEqual([]);
  });

  it('legacy record (no structured_description): the description split still reads the card; no amendments', () => {
    const units = deliver({ description: `deliver — ship it ||| ${CARD} ||| APPROVED INTENT AMENDMENT (gate 2): x` });
    expect(deliverTargetOf(units, 3)).toBe(TARGET);
    expect(unitAmendmentsOf(units, 3)).toEqual([]);
    // The legacy path keeps its known limit (the reason the fields exist):
    expect(deliverTargetOf(deliver({ description: 'deliver — split on a ||| b in the parser' }), 3)).toBe('b in the parser');
  });

  it('no unit at the ord, or no ord: null / none', () => {
    expect(deliverTargetOf(deliver({}), 9)).toBeNull();
    expect(deliverTargetOf(deliver({}), undefined)).toBeNull();
    expect(unitAmendmentsOf(deliver({}), null)).toEqual([]);
  });
});
