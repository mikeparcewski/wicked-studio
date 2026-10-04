import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Consideration } from '../src/api/considered.js';
import { consideredLine } from '../src/board/consideredLine.js';

/**
 * The considered line's words (DES-DECISION-CAPTURE §3 B10, DC-S8): the one sentence, the rows
 * and their verdicts, nothing when nothing touched the turn — and the grep test: the word
 * "Followed" appears nowhere in the product (B4: that verdict waits for DES-rule-check).
 */

function consideration(over: Partial<Consideration> = {}): Consideration {
  return {
    subject: { kind: 'chat', chat_id: 'chat-pay', turn_id: 'd2' },
    key: 'considered:chat-pay:d2',
    project_id: 'upload-endpoint',
    considered: [
      { id: 'proposal:pr-auto', statement: 'Always check the payment provider’s records', severity: 'warn', steering_type: 'development', project: 'upload-endpoint' },
      { id: 'PAT-100', statement: 'Name things in plain words', severity: 'info' },
    ],
    set_aside: [{ id: 'proposal:pr-legacy', statement: 'Ship behind a flag', reason: 'out_of_scope' }],
    cited: [
      { id: 'proposal:pr-auto', by: 'claude', status: 'unchecked', label: 'cited by the step — unchecked' },
      { id: 'POL-999', by: 'claude', status: 'unverified', label: 'not an in-force rule here' },
    ],
    source: 'considerRules',
    ...over,
  };
}

describe('consideredLine — the sentence', () => {
  it('reads "2 of your rules considered · 1 set aside · cited 1 (unchecked) · 1 unverified citation"', () => {
    const m = consideredLine(consideration());
    expect(m?.text).toBe('2 of your rules considered · 1 set aside · cited 1 (unchecked) · 1 unverified citation');
    expect(m?.counts).toEqual({ considered: 2, setAside: 1, cited: 1, unverified: 1 });
  });

  it('leaves out the parts that are zero', () => {
    const m = consideredLine(consideration({ set_aside: [], cited: [] }));
    expect(m?.text).toBe('2 of your rules considered');
  });

  it('says none were considered when only something was set aside', () => {
    const m = consideredLine(consideration({ considered: [], cited: [] }));
    expect(m?.text).toBe('None of your rules considered · 1 set aside');
  });

  it('draws nothing when no rule touched the turn', () => {
    expect(consideredLine(consideration({ considered: [], set_aside: [], cited: [] }))).toBeNull();
  });

  it('draws nothing when the rules could not be read and nothing was cited', () => {
    expect(consideredLine(consideration({ considered: [], set_aside: [], cited: [], source: 'unavailable' }))).toBeNull();
    const m = consideredLine(consideration({ considered: [], set_aside: [], source: 'unavailable' }));
    expect(m?.note).toMatch(/could not be read/);
  });

  it('notes a global-only read', () => {
    expect(consideredLine(consideration({ source: 'global-only' }))?.note).toMatch(/project rules were not considered/);
    expect(consideredLine(consideration())?.note).toBeNull();
  });
});

describe('consideredLine — the rows', () => {
  it('gives each rule one verdict: cited beats considered; set aside by reason; an unverified citation by its id', () => {
    const rows = consideredLine(consideration())?.rows ?? [];
    expect(rows.map((r) => [r.id, r.verdict, r.detail])).toEqual([
      ['proposal:pr-auto', 'cited', 'Cited by claude — unchecked'],
      ['PAT-100', 'considered', 'Considered'],
      ['proposal:pr-legacy', 'set-aside', 'Set aside — other project'],
      ['POL-999', 'unverified', 'Unverified citation by claude — not a rule in force here'],
    ]);
    expect(rows.find((r) => r.id === 'POL-999')?.statement).toBe('[rule:POL-999]');
    expect(rows.find((r) => r.id === 'POL-999')?.opens).toBe(false);
    expect(rows.find((r) => r.id === 'PAT-100')?.opens).toBe(true);
  });

  it('names a unit citer as "the step" and merges two citers of one rule — in the count as well as the rows', () => {
    const m = consideredLine(consideration({
      subject: { kind: 'unit', run_id: 'r-pay-2', ord: 1, attempt: 0 },
      cited: [
        { id: 'proposal:pr-auto', by: 'r-pay-2:u1', status: 'unchecked', label: 'x' },
        { id: 'proposal:pr-auto', by: 'r-pay-2:u1', status: 'unchecked', label: 'x' },
      ],
    }));
    const rows = m?.rows ?? [];
    expect(rows[0]?.detail).toBe('Cited by the step — unchecked');
    expect(rows.filter((r) => r.id === 'proposal:pr-auto')).toHaveLength(1);
    expect(m?.counts.cited).toBe(1);
    expect(m?.text).toBe('2 of your rules considered · 1 set aside · cited 1 (unchecked)');
  });

  it('counts rules, not citations: two seats citing one rule, and one invented id cited twice, each count once', () => {
    const m = consideredLine(consideration({
      cited: [
        { id: 'proposal:pr-auto', by: 'claude', status: 'unchecked', label: 'x' },
        { id: 'proposal:pr-auto', by: 'codex', status: 'unchecked', label: 'x' },
        { id: 'POL-999', by: 'claude', status: 'unverified', label: 'x' },
        { id: 'POL-999', by: 'codex', status: 'unverified', label: 'x' },
      ],
    }));
    expect(m?.counts).toEqual({ considered: 2, setAside: 1, cited: 1, unverified: 1 });
    expect(m?.text).toBe('2 of your rules considered · 1 set aside · cited 1 (unchecked) · 1 unverified citation');
    expect(m?.rows.find((r) => r.verdict === 'cited')?.detail).toBe('Cited by claude and codex — unchecked');
    expect(m?.rows.filter((r) => r.verdict === 'unverified')).toHaveLength(1);
  });

  it('spells every set-aside reason', () => {
    const rows = consideredLine(consideration({
      considered: [], cited: [],
      set_aside: [
        { id: 'a', statement: 'A', reason: 'out_of_scope' }, { id: 'b', statement: 'B', reason: 'replaced' },
        { id: 'c', statement: 'C', reason: 'retired' }, { id: 'd', statement: 'D', reason: 'not_confirmed' },
      ],
    }))?.rows ?? [];
    expect(rows.map((r) => r.detail)).toEqual(['Set aside — other project', 'Set aside — replaced', 'Set aside — retired', 'Set aside — not confirmed yet']);
    // A candidate not yet confirmed has no rule page to open.
    expect(rows.map((r) => r.opens)).toEqual([true, true, true, false]);
  });
});

describe('B4: the word "Followed" is not used anywhere in the product (as the verdict, in any casing)', () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let dirEntry = false;
      try { dirEntry = statSync(p).isDirectory(); } catch { continue; } // an editor's swap file vanishing mid-walk
      if (dirEntry) walk(p, out);
      else if (/\.(ts|tsx|css)$/.test(name)) out.push(p);
    }
    return out;
  }
  it('no source file says "Followed" (DES-rule-check owns that verdict)', () => {
    const root = join(__dirname, '..', 'src');
    // The verdict word in either casing a UI string would use; lowercase prose ("followed by a space") is English, not a verdict.
    const hits = walk(root).filter((p) => /\b(Followed|FOLLOWED)\b/.test(readFileSync(p, 'utf8')));
    expect(hits).toEqual([]);
  }, 120_000); // the walk reads every source file; on a loaded host that far outlives the 5 s default
});
