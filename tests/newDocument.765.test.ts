import { describe, expect, it } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { draftRunOf, draftState } from '../src/board/draftStatus.js';
import { engineFailureOf } from '../src/board/engineFailure.js';
import { formatForMadeKind, madeKindForFormat } from '../src/board/everythingModel.js';
import { madeKindForEditor } from '../src/components/editors/OpenDocumentList.js';
import type { CoreEvent } from '../src/api/types.js';

const run = (id: string, status: string, roots: string[], project = 'notes', created = 1): SessionView =>
  ({ session: { id, status, extra_write_roots: roots, project_id: project, created_at: created }, units: [] }) as unknown as SessionView;

describe('studio#765 — a page with no version says what its draft is doing', () => {
  it('finds the draft run by its interactive-drafts write root, in the project, live first', () => {
    const runs = [
      run('old', 'failed', ['/s/interactive-drafts/tip-page'], 'notes', 1),
      run('live', 'executing', ['/s/interactive-drafts/tip-page'], 'notes', 2),
      run('edit', 'executing', ['/s/interactive-edits/tip-page-v1'], 'notes', 3),
      run('other', 'executing', ['/s/interactive-drafts/tip-page'], 'elsewhere', 4),
    ];
    expect(draftRunOf(runs, 'notes', 'tip-page')?.session.id).toBe('live');
    expect(draftRunOf(runs.slice(0, 1), 'notes', 'tip-page')?.session.id).toBe('old');
    expect(draftRunOf(runs, 'notes', 'tip')).toBeNull();
  });

  it('writing while live, stopped when failed or cancelled, landing when finished, none without a run', () => {
    expect(draftState(run('a', 'executing', []))).toBe('writing');
    expect(draftState(run('a', 'awaiting_human', []))).toBe('writing');
    expect(draftState(run('a', 'failed', []))).toBe('stopped');
    expect(draftState(run('a', 'cancelled', []))).toBe('stopped');
    expect(draftState(run('a', 'completed', []))).toBe('landing');
    expect(draftState(null)).toBe('none');
  });

  it('the engine\'s evaluator≠creator refusal reads in plain words', () => {
    const f = engineFailureOf([{ type: 'error', message: 'plan refused: evaluator≠creator unsatisfiable: no seat distinct from the creator (claude)' }] as unknown as CoreEvent[]);
    expect(f?.headline).toBe('No second helper could check the work: one helper writes it and a different one checks it.');
  });
});

describe('studio#768 — a new document lands where it is filed', () => {
  it('format → list: web page → Pages, slides → Decks, document/brochure → Documents, from the brief → All', () => {
    expect(madeKindForFormat('web')).toBe('pages');
    expect(madeKindForFormat('ppt')).toBe('decks');
    expect(madeKindForFormat('doc')).toBe('documents');
    expect(madeKindForFormat('brochure')).toBe('documents');
    expect(madeKindForFormat('')).toBe('all');
  });

  it('list → format New document starts on; the page editor\'s door lands on Pages', () => {
    expect(formatForMadeKind('pages')).toBe('web');
    expect(formatForMadeKind('decks')).toBe('ppt');
    expect(formatForMadeKind('documents')).toBe('');
    expect(formatForMadeKind('all')).toBe('');
    expect(madeKindForEditor(['page'])).toBe('pages');
    expect(madeKindForEditor(['deck'])).toBe('decks');
    expect(madeKindForEditor([])).toBe('all');
  });
});
