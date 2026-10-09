// studio#275: the run page's unit line carries the discipline (base) skill — `unitDispatched.baseSkill`
// (wicked-core#468) joined to the same unit's `skillsSnapshotHanded.gen`.
import { describe, expect, it } from 'vitest';
import { buildFeed, disciplineLine, type NarratorContext } from '../src/components/narrator.js';
import type { CoreEvent } from '../src/api/types.js';

const ctx: NarratorContext = { phaseOf: (o) => (o === 2 ? 'build' : '?') };
const ev = (e: Record<string, unknown>): CoreEvent => e as unknown as CoreEvent;

describe('disciplineLine', () => {
  it('handed: name, role section and generation', () => {
    expect(disciplineLine({ name: 'gw', role: 'creator', handed: true }, '7')).toBe('discipline: gw §creator gen 7');
  });
  it('handed absent (older engine) is gen ?, never a claim', () => {
    expect(disciplineLine({ name: 'gw', role: 'evaluator' }, '7')).toBe('discipline: gw §evaluator gen ?');
  });
  it('handed false says the seat was only told the name', () => {
    expect(disciplineLine({ name: 'gw', role: 'neutral', handed: false }, '7')).toBe('discipline: gw §neutral (named only — this seat cannot load skills)');
  });
  it('no base skill says nothing', () => {
    expect(disciplineLine(null, '7')).toBeNull();
    expect(disciplineLine(undefined, null)).toBeNull();
  });
});

describe('buildFeed: the dispatch line carries the discipline', () => {
  it('joins the gen from the same unit\'s handoff frame', () => {
    const feed = buildFeed([
      ev({ type: 'unitDispatched', session: 's', ord: 2, attempt: 0, cli: 'claude', baseSkill: { name: 'gw', role: 'creator', handed: true } }),
      ev({ type: 'skillsSnapshotHanded', session: 's', ord: 2, attempt: 0, cli: 'claude', gen: '9', path: 'acp', root: 'r', source: 'published' }),
    ], [], null, ctx);
    const lines = feed.filter((i) => i.kind === 'line').map((i) => (i as { line: { text: string } }).line.text);
    expect(lines).toContain('Worker started build — discipline: gw §creator gen 9');
  });
  it('a run with no base skill keeps the plain line', () => {
    const feed = buildFeed([ev({ type: 'unitDispatched', session: 's', ord: 2, attempt: 0, cli: 'claude', baseSkill: null })], [], null, ctx);
    const lines = feed.filter((i) => i.kind === 'line').map((i) => (i as { line: { text: string } }).line.text);
    expect(lines).toContain('Worker started build');
  });
});
