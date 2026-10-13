import { describe, expect, it } from 'vitest';
import { FakeDocAdapter, SAMPLE_DECK } from '../src/editors/fakeAdapter.js';
import { deckWords, writeVerb } from '../src/editors/host.js';
import { checkOps, inventoryOf } from '../src/editors/ops.js';
import { deckOf } from '../src/board/deck.js';

/**
 * P-D1 — the host's side of a deck op (DES-PRESENTATION-EDITOR-001 I-D1; DES-EDITOR-PLUGINS-001 §5.6):
 * slides named by `data-slide-id` from the HOST's own parse of the version, each deck op alone in its
 * write, and the written line's words the host's own, by the slide's PLACE (never an anchor's index).
 */

const inv = inventoryOf(SAMPLE_DECK);

describe('the host inventory of a deck', () => {
  it('knows each slide by id, its place, its own anchor; and which slide each anchor sits in', () => {
    expect([...inv.slides.entries()].map(([id, s]) => [id, s.n, s.wid])).toStrictEqual([
      ['s-intro', 1, 'section-0'], ['s-first', 2, 'section-1'], ['s-staff', 3, 'section-2'], ['s-pilot', 4, 'section-3'],
    ]);
    expect(inv.wids.get('slide-2-paragraph-1')?.deckN).toBe(3);
  });
  it('a duplicated or unnameable slide id is left out (an op on it could hit the wrong slide)', () => {
    const i = inventoryOf('<section data-slide-id="a"><h1>A</h1></section><section data-slide-id="a"><h1>B</h1></section><section data-slide-id=\'x"]\'><h1>C</h1></section>');
    expect(i.slides.size).toBe(0);
  });
});

describe('checkOps: deck ops', () => {
  it('each op maps to ONE deck wire item, named by the slide', () => {
    expect(checkOps([{ op: 'slide-move', slide: 's-intro', after: 's-pilot' }], inv)).toStrictEqual({ ok: true, items: [{ selector: 's-intro', type: 'deck', op: { type: 'slide-move', slide: 's-intro', after: 's-pilot' } }] });
    expect(checkOps([{ op: 'slide-insert', slide: 's-first', after: null }], inv)).toStrictEqual({ ok: true, items: [{ selector: 's-first', type: 'deck', op: { type: 'slide-insert', slide: 's-first', after: null } }] });
    expect(checkOps([{ op: 'slide-duplicate', slide: 's-staff' }], inv)).toStrictEqual({ ok: true, items: [{ selector: 's-staff', type: 'deck', op: { type: 'slide-duplicate', slide: 's-staff' } }] });
    expect(checkOps([{ op: 'notes-set', slide: 's-pilot', text: 'Say it' }], inv)).toStrictEqual({ ok: true, items: [{ selector: 's-pilot', type: 'deck', op: { type: 'notes-set', slide: 's-pilot', text: 'Say it' } }] });
  });
  it('refuses a slide or an `after` the version does not have, a mixed or doubled write, oversized notes', () => {
    expect(checkOps([{ op: 'slide-move', slide: 's-nope', after: null }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'slide-move', slide: 's-intro', after: 's-nope' }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'slide-move', slide: 's-intro' }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'slide-duplicate', slide: 's-intro' }, { op: 'slide-duplicate', slide: 's-first' }], inv)).toMatchObject({ ok: false, message: 'a slide op is a write of its own' });
    expect(checkOps([{ op: 'slide-duplicate', slide: 's-intro' }, { op: 'remove', anchor: 'slide-0-paragraph-1' }], inv)).toMatchObject({ ok: false, message: 'a slide op is a write of its own' });
    expect(checkOps([{ op: 'notes-set', slide: 's-intro', text: 'x'.repeat(20_001) }], inv)).toMatchObject({ ok: false });
    expect(checkOps([{ op: 'notes-set', slide: 's-intro' }], inv)).toMatchObject({ ok: false });
  });
});

describe('the written line: verbs and the host’s words, by place', () => {
  const words = (ops: unknown[]): [string, string | null] => {
    const c = checkOps(ops, inv);
    if (!c.ok) throw new Error(c.message);
    return [writeVerb(c.items), deckWords(c.items, inv)];
  };
  it('says what happened to which slide', () => {
    expect(words([{ op: 'slide-move', slide: 's-intro', after: 's-pilot' }])).toStrictEqual(['moved', 'slide 1 to after slide 4']);
    expect(words([{ op: 'slide-move', slide: 's-pilot', after: null }])).toStrictEqual(['moved', 'slide 4 to the start']);
    expect(words([{ op: 'slide-insert', slide: 's-first', after: 's-staff' }])).toStrictEqual(['added', 'a slide after slide 3']);
    expect(words([{ op: 'slide-duplicate', slide: 's-staff' }])).toStrictEqual(['duplicated', 'slide 3']);
    expect(words([{ op: 'notes-set', slide: 's-first', text: 'x' }])).toStrictEqual(['changed', 'slide 2’s notes']);
    expect(words([{ op: 'remove', anchor: 'section-2' }])).toStrictEqual(['removed', 'slide 3']);
    expect(words([{ op: 'text', anchor: 'slide-2-paragraph-1', value: 'x', before: 'The whole day at a glance, per branch.' }])).toStrictEqual(['changed', 'slide 3’s text']);
  });
  it('a slide moved to the end is named by its place, though its anchors still say slide 0', () => {
    const moved = SAMPLE_DECK.replace(/(<section[^>]*s-intro[\s\S]*?<\/section>)\n([\s\S]*?)(<\/body>)/, '$2$1\n$3');
    const i = inventoryOf(moved);
    const c = checkOps([{ op: 'text', anchor: 'slide-0-paragraph-1', value: 'x', before: 'A study room in two taps.' }], i);
    expect(c.ok && deckWords(c.items, i)).toBe('slide 4’s text');
  });
  it('a page (no slide ids) keeps the anchor words', () => {
    const page = inventoryOf('<section data-wid="section-0"><h1 data-wid="hero">Hi</h1></section>');
    const c = checkOps([{ op: 'remove', anchor: 'hero' }], page);
    expect(c.ok && deckWords(c.items, page)).toBeNull();
  });
});

describe('the scripted adapter applies deck ops the engine’s way (dev page, conformance)', () => {
  const ids = (a: FakeDocAdapter): (string | null)[] => deckOf(a.headHtml()).map((s) => s.id);
  it('move, duplicate (fresh ids), insert (text cleared, notes dropped), notes set and removed', async () => {
    const a = new FakeDocAdapter(SAMPLE_DECK, 'Deck', { kind: 'deck' });
    expect(a.artifact().kind).toBe('deck');
    const item = (op: Record<string, unknown>) => { const c = checkOps([op], inventoryOf(a.headHtml())); if (!c.ok) throw new Error(c.message); return c.items; };
    expect(await a.write(1, item({ op: 'slide-move', slide: 's-intro', after: 's-pilot' }), 'x')).toStrictEqual({ version: 2 });
    expect(ids(a)).toStrictEqual(['s-first', 's-staff', 's-pilot', 's-intro']);
    expect(await a.write(2, item({ op: 'slide-duplicate', slide: 's-staff' }), 'x')).toStrictEqual({ version: 3 });
    const afterDup = ids(a);
    expect(afterDup).toHaveLength(5);
    expect(afterDup[2]).not.toBe('s-staff');
    expect(new Set(afterDup).size).toBe(5);
    expect(await a.write(3, item({ op: 'slide-insert', slide: 's-intro', after: null }), 'x')).toStrictEqual({ version: 4 });
    const blank = deckOf(a.headHtml())[0]!;
    expect([blank.text, blank.notes]).toStrictEqual(['', '']);
    expect(await a.write(4, item({ op: 'notes-set', slide: 's-pilot', text: 'Mention the eight weeks' }), 'x')).toStrictEqual({ version: 5 });
    expect(deckOf(a.headHtml()).find((s) => s.id === 's-pilot')!.notes).toBe('Mention the eight weeks');
    expect(await a.write(5, item({ op: 'notes-set', slide: 's-pilot', text: '' }), 'x')).toStrictEqual({ version: 6 });
    // codex r1: the first slide moved to the start is the engine's no-op, never lost
    const first = ids(a)[0]!;
    expect(await a.write(6, item({ op: 'slide-move', slide: first, after: null }), 'x')).toMatchObject({ error: 'refused' });
    expect(ids(a)[0]).toBe(first);
    expect(deckOf(a.headHtml()).find((s) => s.id === 's-pilot')!.notes).toBe('');
  });
});
