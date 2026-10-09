// @vitest-environment node
// studio#559: the send-back prefill over the RECORDED S15e verdicts (run ad5a4ca7, unit 7 — the
// rounds whose capture is whole; worktree paths rewritten to /w/). Item count == finding count:
// a bold-paragraph verdict (`**Critical — …**` / `**Concern — …**`) is read per finding (F28), and a
// verdict naming Criticals AND Concerns carries both tiers, labelled (F24).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { failingItems, findingsNote } from '../src/components/gateMoveModel.js';
import type { GateVerdictView } from '../src/components/gateVerdictModel.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 's15eVerdicts');

function verdictOf(reason: string): GateVerdictView {
  return { ord: 7, outcome: 'fail', agentReasoning: null, floor: null, denial: { source: 'evaluator_verdict', reason } } as unknown as GateVerdictView;
}

/** The finding count each round's reviewer derived (its own `Counts:` line, or its paragraphs). */
const FINDINGS: Record<string, number> = {
  a0: 6, a1: 6, a2: 4, a3: 4, a4: 2, a5: 1, a6: 5, a7: 4, a9: 2, a10: 2, a13: 1,
};

describe('failingItems over the recorded S15e verdicts (studio#559)', () => {
  for (const [round, n] of Object.entries(FINDINGS)) {
    it(`${round}: ${n} item(s) — one per finding`, () => {
      const items = failingItems(verdictOf(readFileSync(join(DIR, `${round}.txt`), 'utf8')), null);
      expect(items).toHaveLength(n);
      // Never a frame/commands/counts paragraph, never an absolute path.
      for (const i of items) expect(i).not.toMatch(/^(?:\*\*)?(?:Commands|Counts|What I did|Evaluator review|ADVICE)\b|\/w\//);
    });
  }

  it('F24: round 1 (3 Critical + 3 Concerns) carries all six, labelled, and the note names the tiers', () => {
    const items = failingItems(verdictOf(readFileSync(join(DIR, 'a0.txt'), 'utf8')), null);
    expect(items.filter((i) => i.startsWith('Critical: '))).toHaveLength(3);
    expect(items.filter((i) => i.startsWith('Concern: '))).toHaveLength(3);
    expect(findingsNote(items, 'reviewer').split('\n')[0]).toBe("Fix the reviewer's failing items (Critical (3) · Concerns (3)):");
  });

  it('F28: the bold-paragraph form reads the title and body of each finding, not the frame paragraphs', () => {
    const items = failingItems(verdictOf(readFileSync(join(DIR, 'a4.txt'), 'utf8')), null);
    expect(items[0]).toMatch(/^Critical: wrong run’s diff can appear in a deliver card — ProposalCard\.tsx:76 stores one diff/);
    expect(items[1]).toMatch(/^Concern: the diffstat fallback is skipped for an incomplete diff response — /);
  });

  it('a lone "Condition to pass" paragraph is the finding when no severity paragraph names one', () => {
    expect(failingItems(verdictOf(readFileSync(join(DIR, 'a5.txt'), 'utf8')), null)).toEqual([
      expect.stringMatching(/^The run-switch test at sessionView\.gateRow\.s15e\.test\.tsx:251 succeeds when run B’s diffstat is absent/),
    ]);
  });

  it('a one-tier list stays bare (no labels, no tier header)', () => {
    const items = failingItems(verdictOf(readFileSync(join(DIR, 'a10.txt'), 'utf8')), null);
    expect(items.some((i) => /^(Critical|Concern): /.test(i))).toBe(false);
    expect(findingsNote(items, 'reviewer').split('\n')[0]).toBe("Fix the reviewer's failing items:");
  });
});
