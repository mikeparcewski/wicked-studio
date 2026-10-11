// S16a-4c: a made thing opens in the session that made it (X1 retired the shell addresses it moved).
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { madeOpenAddress } from '../src/board/madeMoves.js';
import { makeView } from './factories.js';

function docRun(id: string, over: Record<string, unknown> = {}): SessionView {
  return makeView({ id, status: 'completed', project_id: 'notes', extra_write_roots: ['/w/interactive-drafts/offsite-plan'], created_at: 100, ...over });
}

describe('S16a-4c — where a made thing opens', () => {
  it('a bound document opens on its run\'s session at full size, its version kept', () => {
    const runs = [docRun('r-doc')];
    expect(madeOpenAddress('document', 'notes', 'offsite-plan', runs, false, 2))
      .toBe('/s/run%3Ar-doc/a/r-doc%3Anotes%2Foffsite-plan?size=full&v=2');
  });

  it('only an archived run bound: the newest archived one', () => {
    const runs = [docRun('r-old', { archived_at: 5, created_at: 50 }), docRun('r-new', { archived_at: 6, created_at: 90 })];
    expect(madeOpenAddress('document', 'notes', 'offsite-plan', runs, false)).toBe('/s/run%3Ar-new/a/r-new%3Anotes%2Foffsite-plan?size=full');
  });

  it('no run bound: the Made list with the document open', () => {
    expect(madeOpenAddress('document', 'notes', 'offsite-plan', [], false)).toBe('/everything?tab=made&project=notes&kind=documents&open=offsite-plan');
  });

  it('a demo video opens on its run\'s session; an unknown run lands on its session address', () => {
    const runs = [makeView({ id: 'r-demo', status: 'completed', project_id: 'notes' })];
    expect(madeOpenAddress('video', 'notes', 'r-demo', runs, false)).toBe('/s/run%3Ar-demo/a/r-demo%3Arun%2Fdemo-video?size=full');
    expect(madeOpenAddress('video', 'notes', 'r-gone', runs, false)).toBe('/s/run%3Ar-gone');
  });
});
