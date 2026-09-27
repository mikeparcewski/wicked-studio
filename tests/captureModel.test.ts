import { describe, expect, it } from 'vitest';
import {
  captureClass,
  captureConsequence,
  captureFiled,
  captureFiledChip,
  captureFiledLine,
  isCaptureImage,
} from '../src/board/captureModel.js';
import { proposalConsequenceLine } from '../src/board/proposalTriage.js';
import type { Proposal } from '../src/api/proposals.js';

/**
 * Studio OS behaviour 8, "Capture anything", on the actionable pattern: the drop says its
 * consequence first; what the capture run files lands in Home's EXISTING proposal triage, whose
 * line names what the team filed each row as; the drop's status line counts what was filed and
 * what still waits there, by consequence.
 */

function row(id: string, capture: string | undefined, over: Partial<Proposal> = {}): Proposal {
  return {
    id,
    kind_type: 'memory',
    payload: { content: `${id} text`, tier: 'semantic', ...(capture !== undefined ? { capture } : {}) },
    facets: { project: 'upload-endpoint' },
    provenance: { run_id: 'r-capture' },
    state: 'pending',
    created_at: 1_700_000_000,
    ...over,
  };
}

const rule = (id: string, over: Partial<Proposal> = {}): Proposal =>
  row(id, undefined, { kind_type: 'policy:development', payload: { rule: 'stream uploads', severity: 'warn', capture: 'rule' }, ...over });

describe('captureClass', () => {
  it('reads payload.capture; a policy row is a rule only when the capture filed it', () => {
    expect(captureClass(row('a', 'intent'))).toBe('intent');
    expect(captureClass(row('b', 'decision'))).toBe('decision');
    expect(captureClass(row('c', 'memory'))).toBe('memory');
    expect(captureClass(rule('d'))).toBe('rule');
    expect(captureClass(row('e', undefined, { kind_type: 'policy:security', payload: { rule: 'r' } }))).toBeNull();
    expect(captureClass(row('f', undefined))).toBeNull();
    expect(captureClass(row('g', 'gossip'))).toBeNull();
    expect(captureClass(row('h', 'intent', { payload: 'not an object' }))).toBeNull();
  });
});

describe('the triage line names what a capture filed, consequence first', () => {
  it('a captured decision is memory-only', () => {
    expect(proposalConsequenceLine(row('d', 'decision'))).toBe('Memory only — a captured decision: adds a memory; enforcement unchanged');
  });
  it('a captured rule changes enforcement', () => {
    expect(proposalConsequenceLine(rule('r'))).toBe('Changes enforcement — lands a development rule (warn) from your capture');
  });
  it('a row no capture filed keeps its line', () => {
    expect(proposalConsequenceLine(row('m', undefined))).toBe('Memory only — adds a memory; enforcement unchanged');
  });
});

describe('captureConsequence', () => {
  it('says where the proposals land and that nothing is kept until accepted', () => {
    const c = captureConsequence('upload-endpoint');
    expect(c).toMatch(/proposals on upload-endpoint/);
    expect(c).toMatch(/Needs You on Home/);
    expect(c).toMatch(/Nothing is kept until you accept it/);
  });
});

describe('captureFiled / captureFiledLine', () => {
  const pending = [
    row('i1', 'intent'),
    row('d1', 'decision'),
    rule('r1'),
    row('other-run', 'memory', { provenance: { run_id: 'r-else' } }),
  ];

  it('counts only the run\'s pending rows, split by consequence', () => {
    expect(captureFiled(pending, 'r-capture', [])).toEqual({ seen: 3, waiting: 3, memoryOnly: 2, changesEnforcement: 1 });
  });

  it('keeps a decided row in what was filed', () => {
    const f = captureFiled(pending.filter((p) => p.id !== 'd1'), 'r-capture', ['i1', 'd1', 'r1']);
    expect(f).toEqual({ seen: 3, waiting: 2, memoryOnly: 1, changesEnforcement: 1 });
  });

  it('says it in words: reading, waiting (by consequence), all decided, nothing filed', () => {
    const none = { seen: 0, waiting: 0, memoryOnly: 0, changesEnforcement: 0 };
    expect(captureFiledLine(none, 'upload-endpoint', false)).toBe('Captured to upload-endpoint: the team is reading it…');
    expect(captureFiledLine(none, 'upload-endpoint', true)).toBe('Captured to upload-endpoint: the team filed nothing');
    expect(captureFiledLine({ seen: 3, waiting: 3, memoryOnly: 2, changesEnforcement: 1 }, 'upload-endpoint', true))
      .toBe('3 proposals from your capture waiting in Needs You: 2 memory-only, 1 changes enforcement');
    expect(captureFiledLine({ seen: 1, waiting: 1, memoryOnly: 1, changesEnforcement: 0 }, 'upload-endpoint', false))
      .toBe('1 proposal from your capture waiting in Needs You: 1 memory-only (the team is still reading)');
    expect(captureFiledLine({ seen: 3, waiting: 0, memoryOnly: 0, changesEnforcement: 0 }, 'upload-endpoint', true))
      .toBe('3 proposals filed from your capture to upload-endpoint: all decided');
  });
});

describe('captureFiledChip — the short status beside Home\'s Capture verb', () => {
  it('reading, waiting, all decided, nothing filed', () => {
    expect(captureFiledChip({ seen: 0, waiting: 0, memoryOnly: 0, changesEnforcement: 0 }, false)).toBe('reading…');
    expect(captureFiledChip({ seen: 0, waiting: 0, memoryOnly: 0, changesEnforcement: 0 }, true)).toBe('nothing filed');
    expect(captureFiledChip({ seen: 5, waiting: 5, memoryOnly: 4, changesEnforcement: 1 }, false)).toBe('5 waiting');
    expect(captureFiledChip({ seen: 5, waiting: 0, memoryOnly: 0, changesEnforcement: 0 }, true)).toBe('all decided');
  });
});

describe('isCaptureImage', () => {
  it('reads the type, falling back to the extension', () => {
    expect(isCaptureImage({ name: 'board.png', type: 'image/png' })).toBe(true);
    expect(isCaptureImage({ name: 'board.JPG', type: '' })).toBe(true);
    expect(isCaptureImage({ name: 'notes.md', type: 'text/markdown' })).toBe(false);
  });
});
