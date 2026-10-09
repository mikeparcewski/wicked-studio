// S16a-4c: a made thing opens in the session that made it; the shell's document / video addresses move.
import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { madeOpenAddress, runMadeMove, staticMadeMove } from '../src/board/madeMoves.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { makeView } from './factories.js';

function docRun(id: string, over: Record<string, unknown> = {}): SessionView {
  return makeView({ id, status: 'completed', project_id: 'notes', extra_write_roots: ['/w/interactive-drafts/offsite-plan'], created_at: 100, ...over });
}

describe('S16a-4c — the moves', () => {
  it('the bare and /new forms land on the project\'s Made list at once', () => {
    expect(staticMadeMove('/p/notes/document')).toBe('/everything?tab=made&project=notes&kind=documents');
    expect(staticMadeMove('/p/notes/document/new')).toBe('/everything?tab=made&project=notes&kind=documents');
    expect(staticMadeMove('/p/notes/video')).toBe('/everything?tab=made&project=notes&kind=videos');
    expect(staticMadeMove('/p/notes/video/new')).toBe('/everything?tab=made&project=notes&kind=videos');
    expect(staticMadeMove('/p/notes/document/offsite-plan')).toBeNull();
    expect(staticMadeMove('/p/notes/build')).toBeNull();
    expect(parseRoute('/p/notes/document/offsite-plan')).toMatchObject({ panel: 'everything', projectId: 'notes' });
    expect(parseRoute('/p/notes/document/a/b').panel).toBe('not-found');
  });

  it('a bound document opens on its run\'s session at full size, ?v kept', () => {
    const runs = [docRun('r-doc')];
    expect(runMadeMove('/p/notes/document/offsite-plan', '?v=2', runs, false))
      .toBe('/s/run%3Ar-doc/a/r-doc%3Anotes%2Foffsite-plan?size=full&v=2');
  });

  it('only an archived run bound: the newest archived one', () => {
    const runs = [docRun('r-old', { archived_at: 5, created_at: 50 }), docRun('r-new', { archived_at: 6, created_at: 90 })];
    expect(runMadeMove('/p/notes/document/offsite-plan', '', runs, false)).toBe('/s/run%3Ar-new/a/r-new%3Anotes%2Foffsite-plan?size=full');
  });

  it('no run bound: the Made list with the document open', () => {
    expect(runMadeMove('/p/notes/document/offsite-plan', '', [], false)).toBe('/everything?tab=made&project=notes&kind=documents&open=offsite-plan');
  });

  it('a demo video opens on its run\'s session; an unknown run lands on its session address', () => {
    const runs = [makeView({ id: 'r-demo', status: 'completed', project_id: 'notes' })];
    expect(runMadeMove('/p/notes/video/r-demo', '', runs, false)).toBe('/s/run%3Ar-demo/a/r-demo%3Arun%2Fdemo-video?size=full');
    expect(madeOpenAddress('video', 'notes', 'r-gone', runs, false)).toBe('/s/run%3Ar-gone');
  });
});
