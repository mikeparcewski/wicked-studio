/**
 * J6 S1: the domain model view's words, orderings and ruling bodies, read from crew's own answer shapes
 * (tests/fixtures/domain-v3/README.md: crew's mappers over the real core and garden output).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/errors.js';
import type { DomainModel, DomainScopeCard } from '../src/api/domainModel-wire.js';
import {
  cardPhrases,
  domainModelOf,
  editPhrases,
  followupAction,
  followupsInOrder,
  groupsByArea,
  modelHeadline,
  rulingBodyFor,
  rulingRefusalWords,
  whereLine,
} from '../src/board/domainModel.js';

const fx = (n: string): unknown => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'domain-v3', n), 'utf8'));
const BUILT = fx('model-built.crew.json') as DomainModel;
const RULED = fx('model-after-rulings.crew.json') as DomainModel;
const CARD = fx('scope-mini-cobol.crew.json') as DomainScopeCard;
const READ = 'ts-cobol . . . app/cbl/PAYCALC1/PAYCALC1#READ-PARA().';
const MAIN = 'ts-cobol . . . app/cbl/PAYCALC1/PAYCALC1#MAIN-PARA().';

describe('the model on the page', () => {
  it('reads the model a page carries, and none from a 1.1.0 page or a broken one', () => {
    expect(domainModelOf({ items: [], model: BUILT })).toBe(BUILT);
    expect(domainModelOf({ items: [] })).toBeNull();
    expect(domainModelOf({ model: { ...BUILT, followups: undefined } })).toBeNull();
    expect(domainModelOf({ model: { ...BUILT, accounting: null } })).toBeNull();
    expect(domainModelOf(null)).toBeNull();
  });

  it('says the model in words: rules, checked statements, follow-ups left, targets accounted', () => {
    expect(modelHeadline(BUILT)).toBe('1 rule · 1 checked statement · 4 follow-ups · 2 of 4 targets accounted');
    // After a Confirm, a Reject and a target Confirm: the confirmed statement counts as checked, ruled rows are done.
    expect(modelHeadline(RULED)).toBe('1 rule · 2 checked statements · 1 follow-up · 3 of 4 targets accounted');
  });

  it('lists business groups before housekeeping, by area', () => {
    const chore = { ...BUILT.ruleGroups[0]!, id: 'h1', title: 'Close the files', kind: 'housekeeping', area: 'PAYCALC1' };
    const other = { ...BUILT.ruleGroups[0]!, id: 'b2', title: 'Job steps', area: 'PAYJOB' };
    const areas = groupsByArea({ ...BUILT, ruleGroups: [chore, other, ...BUILT.ruleGroups] });
    expect(areas.map((a) => a.area)).toEqual(['PAYCALC1', 'PAYJOB']);
    expect(areas[0]!.groups.map((g) => g.title)).toEqual(['Overtime pay', 'Close the files']);
  });
});

describe('follow-ups', () => {
  it('orders the rows a person works: unruled first, then flagged, open, refused, scope', () => {
    expect(followupsInOrder(BUILT).map((f) => [f.n, f.kind])).toEqual([[1, 'flagged'], [2, 'open'], [3, 'open'], [4, 'refused']]);
    expect(followupsInOrder(RULED).map((f) => [f.n, f.ruling?.action ?? null])).toEqual([[1, null], [2, 'confirm'], [3, 'reject'], [4, 'confirm']]);
    expect(whereLine(BUILT.followups[3]!)).toBe('app/cbl/PAYCALC1.cbl:15-19');
  });

  it("a statement's ruling names its key and its target's hash as this model gives them", () => {
    const open = BUILT.followups.find((f) => f.n === 2)!;
    const st = BUILT.statements.find((s) => s.id === open.statement)!;
    const target = BUILT.targets.find((t) => t.id === READ)!;
    expect(followupAction(BUILT, open)).toBe('statement');
    expect(rulingBodyFor(BUILT, open, 'confirm')).toEqual({ statement: st.id, expect: st.key, expectTarget: target.targetHash, action: 'confirm' });
    expect(rulingBodyFor(BUILT, open, 'reject', '  The FD is out of scope.  '))
      .toEqual({ statement: st.id, expect: st.key, expectTarget: target.targetHash, action: 'reject', note: 'The FD is out of scope.' });
    // A reject says what is wrong.
    expect(rulingBodyFor(BUILT, open, 'reject', ' ')).toBeNull();
  });

  it("an unaccounted target's row confirms its lines, and only confirms", () => {
    const refused = BUILT.followups.find((f) => f.kind === 'refused')!;
    const target = BUILT.targets.find((t) => t.id === MAIN)!;
    expect(followupAction(BUILT, refused)).toBe('target');
    expect(rulingBodyFor(BUILT, refused, 'confirm')).toEqual({ target: MAIN, expectTarget: target.targetHash, action: 'confirm' });
    expect(rulingBodyFor(BUILT, refused, 'reject', 'no')).toBeNull();
  });

  it('a ruled row, a row the model cannot name, and a scope row offer nothing', () => {
    for (const f of RULED.followups.filter((x) => x.ruling !== null)) expect(followupAction(RULED, f)).toBe('none');
    const gone = { ...BUILT.followups[1]!, statement: 'not in the model' };
    expect(followupAction(BUILT, gone)).toBe('none');
    const scope = { ...BUILT.followups[3]!, kind: 'scope', target: null };
    expect(followupAction(BUILT, scope)).toBe('none');
  });

  it("says crew's refusals in words, keeping crew's sentence", () => {
    const stale = new ApiError(409, 'the code changed since the model was read', { error: 'the code changed since the model was read', code: 'stale_code' });
    expect(rulingRefusalWords(stale)).toBe('The code or the model changed since this was read; it has been read again. (the code changed since the model was read)');
    expect(rulingRefusalWords(new ApiError(409, 'already ruled', { code: 'not_open' }))).toMatch(/^This was already settled/);
    expect(rulingRefusalWords(new ApiError(403, 'only a person may rule', { code: 'ruling_refused' }))).toMatch(/^Only a person can rule/);
  });
});

describe('the scope card', () => {
  it("lists the card's phrases and edits them: drop one, add one, never doubled or empty", () => {
    expect(cardPhrases(CARD)).toEqual(['PAYCALC1']);
    expect(editPhrases(null, CARD, { add: ' PAYJOB ' })).toEqual(['PAYCALC1', 'PAYJOB']);
    expect(editPhrases(['PAYCALC1', 'PAYJOB'], CARD, { add: 'PAYJOB' })).toEqual(['PAYCALC1', 'PAYJOB']);
    expect(editPhrases(['PAYCALC1', 'PAYJOB'], CARD, { drop: 'PAYCALC1' })).toEqual(['PAYJOB']);
    expect(editPhrases(null, CARD, { add: 'x'.repeat(201) })).toEqual(['PAYCALC1']);
    expect(editPhrases(null, null, { add: 'PAYJOB' })).toBeNull();
  });
});
