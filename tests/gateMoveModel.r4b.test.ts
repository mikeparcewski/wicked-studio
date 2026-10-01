// R4 again (ship-prove-4): studio 0.5.18 still led a send-back with "Read governed-worker skill —
// exit 0. (+3 more)". The evaluator headed its section "Critical finding:" (singular, severity-led),
// and only a heading starting with "findings" opened the Findings section, so the reading fell back
// to every bullet of the report. The fix works from BOTH sides: a tolerant findings-heading match,
// and known non-finding sections (Commands run, Evidence, Verified, …) never read as findings,
// whatever else the report holds. With nothing left, the headline says the review failed and points
// to the full verdict — it never lists commands.
import { describe, expect, it } from 'vitest';
import { failingItems, recommendGateMove, type GateMoveInput } from '../src/components/gateMoveModel.js';
import { gateVerdictFor } from '../src/components/gateVerdictModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { MOVE_RUN, MOVE_UNITS, NOT_PASS_PROMPT } from './fixtures/gateMove.js';
import { SHIP_PROVE_4_UNIT5_OUTPUT } from './fixtures/shipProve4Review.js';

function events(reason: string): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: MOVE_RUN, ord: 2, attempt: 0 },
    {
      type: 'gateEvaluated', session: MOVE_RUN, ord: 2,
      agentReasoning: null, agentVerdict: null, combined: false, criterion: null,
      denial: { claimId: null, deniedTool: null, phase: 'unit-2', reason, ruleIds: [], source: 'evaluator_verdict' },
      denialReason: reason, deterministicPass: true, evaluatorPass: true, evaluatorPolicies: [],
      evaluatorVerdict: 'FAIL', hasDeterministicFloor: false, judgeCli: null, judgeDistinct: null,
    },
    {
      type: 'gateEscalated', session: MOVE_RUN, ord: 2, attempt: 0, condition: 'verdict_not_pass',
      denialSource: 'evaluator_verdict', verdictSummary: reason, outputCaptured: true,
    },
  ] as unknown as CoreEvent[];
}

function input(over: Partial<GateMoveInput>): GateMoveInput {
  return {
    runId: MOVE_RUN, ord: 2, units: MOVE_UNITS, verdict: null, verdictSummary: null, escalationGate: true,
    hasLift: false, restoredRetry: false, isPlanGate: false, planView: null, diffstat: null, ...over,
  };
}

const read = (text: string): string[] => failingItems(gateVerdictFor(events(text), 2, NOT_PASS_PROMPT), text);
const moveFor = (text: string) =>
  recommendGateMove(input({ verdict: gateVerdictFor(events(text), 2, NOT_PASS_PROMPT), verdictSummary: text }));

/** The real reason as the engine frames it: the verdict line, then the evaluator's output. */
const REAL = `the evaluator's verdict is FAIL\n${SHIP_PROVE_4_UNIT5_OUTPUT}`;
const REAL_FINDING = SHIP_PROVE_4_UNIT5_OUTPUT.split('\n').find((l) => l.startsWith('- `src/format.ts:11`'))!.slice(2);

describe('failingItems — ship-prove-4 run 1 unit 5, the real evaluator text (R4)', () => {
  it('reads the one Critical finding, never the Commands run bullets', () => {
    expect(REAL_FINDING).toMatch(/^`src\/format\.ts:11` slices UTF-16 code units\./);
    expect(read(REAL)).toEqual([REAL_FINDING]);
  });

  it('the send-back headline leads with the finding', () => {
    const move = moveFor(REAL);
    expect(move?.kind).toBe('send-back');
    expect(move?.label).toMatch(/^Send back to the creator: `src\/format\.ts:11` slices UTF-16/);
    expect(move?.label).not.toMatch(/exit 0|governed-worker|\(\+\d+ more\)/);
    expect(move?.consequence).toMatch(/reruns with 1 item;/);
  });
});

const COMMANDS = ['Commands run:', '', '- Read governed-worker skill — exit 0.', '- `npm test` — exit 0.', ''];
const FINDING = 'src/a.ts:3 drops the last item.';

describe('failingItems — a findings section, however it is headed (R4)', () => {
  const names = [
    'Findings', 'Finding', 'findings', 'FINDINGS', 'Critical finding', 'Critical findings', 'Blocking finding',
    'Findings (critical)', 'Findings — blocking', 'Concerns', 'Concern', 'Issues', 'Issue', 'Problems',
    'Blocking issues', 'Blockers', 'High-severity findings',
  ];
  const dress: Array<[string, (n: string) => string]> = [
    ['X:', (n) => `${n}:`],
    ['X', (n) => n],
    ['## X', (n) => `## ${n}`],
    ['**X:**', (n) => `**${n}:**`],
    ['**X**:', (n) => `**${n}**:`],
  ];
  for (const name of names) {
    for (const [style, wrap] of dress) {
      it(`"${style}" with X = "${name}"`, () => {
        const text = ["the evaluator's verdict is FAIL", ...COMMANDS, wrap(name), '', `- ${FINDING}`, '', 'VERDICT: FAIL'].join('\n');
        expect(read(text)).toEqual([FINDING]);
      });
    }
  }
});

describe('failingItems — known non-finding sections are never findings (R4)', () => {
  const excluded = [
    'Commands run', 'Command run', 'Evidence', 'Run-record evidence', 'Verified', 'What I checked', 'What I did',
    'Suggestions', 'Suggestion', 'Notes', 'Note', 'Summary', 'Counts', 'Open questions',
  ];
  for (const name of excluded) {
    it(`"${name}:" with no findings section lists nothing, and the headline says the review failed`, () => {
      const text = ["the evaluator's verdict is FAIL", `${name}:`, '- Read governed-worker skill — exit 0.', '- `npm test` — exit 0.', 'VERDICT: FAIL'].join('\n');
      expect(read(text)).toEqual([]);
      const move = moveFor(text);
      expect(move?.kind).toBe('send-back');
      expect(move?.label).toMatch(/review failed/i);
      expect(move?.label).toMatch(/full verdict/i);
      expect(move?.label).not.toMatch(/exit 0|governed-worker/);
      expect(move?.items).toEqual([]);
    });

    it(`"## ${name}" after a findings section is outside it`, () => {
      const text = ["the evaluator's verdict is FAIL", 'Critical finding:', `- ${FINDING}`, `## ${name}`, '- Read governed-worker skill — exit 0.', 'VERDICT: FAIL'].join('\n');
      expect(read(text)).toEqual([FINDING]);
    });

    it(`"**${name}:**" in an unsectioned report drops only its own bullets`, () => {
      const text = ["the evaluator's verdict is FAIL", `- ${FINDING}`, `**${name}:**`, '- Read governed-worker skill — exit 0.', 'VERDICT: FAIL'].join('\n');
      expect(read(text)).toEqual([FINDING]);
    });
  }

  it('inline non-finding leads in prose are not findings either ("Counts: …", "What I did: …")', () => {
    const text = [
      "the evaluator's verdict is FAIL",
      'What I did: Evaluator role. No files were modified.',
      'Commands run: read the skill — exit 0.',
      'Counts: derived 1 / submitted 1 / failed 0.',
      'VERDICT: FAIL',
    ].join('\n');
    expect(read(text)).toEqual([]);
    expect(moveFor(text)?.label).toMatch(/review failed/i);
  });

  it('with nothing to list, the note carries the full verdict, not a guessed finding', () => {
    const text = ["the evaluator's verdict is FAIL", ...COMMANDS, 'VERDICT: FAIL'].join('\n');
    const move = moveFor(text);
    expect(move?.prefill).toContain('full verdict');
    expect(move?.prefill).toContain('Read governed-worker skill — exit 0.');
    expect(move?.consequence).toMatch(/reruns with the reviewer's full verdict/);
  });
});

describe('failingItems — codex review of this fix', () => {
  it('a NUMBERED findings heading opens the section after an excluded one (HIGH)', () => {
    const text = ["the evaluator's verdict is FAIL", 'Commands run:', '- npm test — exit 0.', '1. Findings', `- ${FINDING}`, '2. Notes', '- none of note.', 'VERDICT: FAIL'].join('\n');
    expect(read(text)).toEqual([FINDING]);
  });

  it('a bulleted non-finding sub-heading inside Findings keeps its bullets out (HIGH)', () => {
    const only = ["the evaluator's verdict is FAIL", 'Findings:', '- Commands run:', '  - npm test — exit 0.', 'VERDICT: FAIL'].join('\n');
    expect(read(only)).toEqual([]);
    expect(moveFor(only)?.label).toMatch(/review failed/i);
    const mixed = ["the evaluator's verdict is FAIL", 'Findings:', '- **Evidence:**', '  - npm test — exit 0.', `- ${FINDING}`, '- Commands run: npm run lint — exit 0.', 'VERDICT: FAIL'].join('\n');
    expect(read(mixed)).toEqual([FINDING]);
  });
});

describe('failingItems — codex review, round 2', () => {
  it('an inline "- Commands run: …" bullet owns its nested bullets (HIGH)', () => {
    const text = ["the evaluator's verdict is FAIL", '## Findings', '- Commands run: npm test', '  - exit 0', `- ${FINDING}`, 'VERDICT: FAIL'].join('\n');
    expect(read(text)).toEqual([FINDING]);
  });

  it('a qualified findings heading ("## Actionable findings", "Key issues:") opens the section', () => {
    for (const head of ['## Actionable findings', 'Key issues:', '**Review findings (blocking):**']) {
      const text = ["the evaluator's verdict is FAIL", '## Commands run', '- npm test', '## Approach', '- read the diff', head, `- ${FINDING}`, 'VERDICT: FAIL'].join('\n');
      expect(read(text)).toEqual([FINDING]);
    }
  });
});
