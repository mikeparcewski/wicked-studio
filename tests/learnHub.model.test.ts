import { describe, expect, it } from 'vitest';
import {
  firstNameOf, firstRunOpen, nextSetupAsk, PERSONA_PRESETS, previewAnswer, readFirstRun, rulesYouCareAbout, siteOfEmail,
  STARTER_RULES, starterAdoption, starterRule, starterUpdate, styleStations, writingStyleNotes, jobLine, repoStyleProblem,
} from '../src/board/learnHub.js';
import { LEARN_ITEM, navCurrent, navGroups, NAV_GROUPS } from '../src/board/navModel.js';
import type { ConformanceRule, SessionView } from '../src/api/types.js';

/** program DES-LEARN §3-§4, the pure half: where Learn sits, the first run's blob, the persona preview, starters, Style. */

describe('Learn in the sidebar (§3.0; operator 2026-11-04: at the foot, above Build & settings, for good)', () => {
  it('is in no group, whatever the first run says (the rail places it in its foot: sidebarSections.test.tsx)', () => {
    for (const groups of [NAV_GROUPS, navGroups(), navGroups({ sources: true })]) {
      expect(groups.flatMap((g) => g.items).some((i) => i.id === 'learn')).toBe(false);
    }
    expect(navGroups().find((g) => g.id === 'work')!.items.map((i) => i.id)).toEqual(['projects', 'jobs', 'apps', 'repos']);
    expect(navGroups().find((g) => g.id === 'insight')!.items.map((i) => i.id)).toEqual(['report', 'understand', 'evaluate']);
  });

  it('is the current page under /learn', () => {
    expect(navCurrent('/learn')).toBe('learn');
    expect(LEARN_ITEM.path).toBe('/learn');
  });

});

describe('studio.firstRun', () => {
  it('reads a well-formed blob and drops what is not', () => {
    expect(readFirstRun({ 'studio.firstRun': { learnUsedAt: 5, ignoredAt: 'x', answers: { repos: { line: 'l', words: 'w', done: true }, rules: { line: 1 } } } }))
      .toEqual({ learnUsedAt: 5, answers: { repos: { line: 'l', words: 'w', done: true } } });
    expect(readFirstRun({})).toEqual({});
    expect(readFirstRun({ 'studio.firstRun': [] })).toEqual({});
  });

  it('is open until ignored or complete; the next ask is the first unanswered', () => {
    expect(firstRunOpen({})).toBe(true);
    expect(firstRunOpen({ ignoredAt: 1 })).toBe(false);
    expect(firstRunOpen({ completedAt: 1 })).toBe(false);
    expect(nextSetupAsk({})).toBe('repos');
    expect(nextSetupAsk({ answers: { repos: { line: '', words: '', done: true }, agents: { line: '', words: '', done: false } } })).toBe('style');
  });

  it('a site from a work email, never from a public mail host', () => {
    expect(siteOfEmail('sam@acme.dev')).toBe('acme.dev');
    expect(siteOfEmail('sam@gmail.com')).toBeNull();
    expect(siteOfEmail('1+sam@users.noreply.github.com')).toBeNull();
    expect(siteOfEmail(null)).toBeNull();
    expect(siteOfEmail('nope')).toBeNull();
  });
});

describe('the personality preview', () => {
  const p = PERSONA_PRESETS[0]!.persona;
  const words = (b: ReturnType<typeof previewAnswer>): string => b.map((x) => ('text' in x ? x.text : '')).join(' ');

  it('pushback, initiative and habits each change the answer', () => {
    expect(words(previewAnswer({ ...p, dials: { ...p.dials, pushback: 2 } }, 0, null))).toContain('rather fix the bound');
    expect(words(previewAnswer({ ...p, dials: { ...p.dials, pushback: 0 } }, 0, null))).not.toContain('rather fix');
    expect(words(previewAnswer({ ...p, dials: { ...p.dials, initiative: 2 } }, 0, null))).toContain('I’ve started');
    expect(words(previewAnswer({ ...p, dials: { ...p.dials, initiative: 0 } }, 0, null))).toContain('or will you?');
    const cited = previewAnswer({ ...p, habits: ['cites'] }, 0, null);
    expect(cited.some((b) => b.kind === 'p' && b.cite !== undefined)).toBe(true);
    expect(previewAnswer({ ...p, habits: [] }, 0, null).some((b) => b.kind === 'p' && b.cite !== undefined)).toBe(false);
  });

  it('thorough adds the steps or the table; short is sentences only, with the not-checked note', () => {
    expect(previewAnswer({ ...p, dials: { ...p.dials, length: 2 } }, 0, null).some((b) => b.kind === 'steps')).toBe(true);
    expect(previewAnswer({ ...p, dials: { ...p.dials, length: 2 } }, 1, null).some((b) => b.kind === 'table')).toBe(true);
    const short = previewAnswer({ ...p, dials: { ...p.dials, length: 0 }, habits: ['says-unchecked', 'tables'] }, 1, null);
    expect(short.some((b) => b.kind === 'table' || b.kind === 'steps')).toBe(false);
    expect(previewAnswer({ ...p, dials: { ...p.dials, length: 0 }, habits: ['says-unchecked'] }, 0, null).at(-1)).toMatchObject({ kind: 'quiet' });
  });

  it('calls the person by their first name only with the habit', () => {
    expect(words(previewAnswer({ ...p, habits: ['names'] }, 0, 'Sam Rivera'))).toMatch(/^Sam, /u);
    expect(words(previewAnswer({ ...p, habits: [] }, 0, 'Sam Rivera'))).not.toContain('Sam');
  });
});

describe('starter rules (§3.2)', () => {
  it('each is a valid policy with ui provenance and a learn:starter ref', () => {
    for (const s of STARTER_RULES) {
      const r = starterRule(s);
      expect(r).toMatchObject({ id: s.id, rule_type: 'policy', severity: 'warn', steering_type: s.type, provenance: { source: 'ui', ref: 'learn:starter' } });
      expect(r.id.startsWith('PAT-') || r.id.startsWith('POL-')).toBe(false);
      expect(r.confidence).toBeGreaterThan(0);
    }
  });

  it('rules you care about: added or adopted by a person, not built in or imported, not retired', () => {
    const r = (id: string, source: string, retired = false): ConformanceRule => ({ ...starterRule(STARTER_RULES[0]!), id, provenance: { source, source_kinds: [] }, retired } as ConformanceRule);
    expect(rulesYouCareAbout([r('a', 'ui'), r('b', 'chat'), r('c', 'doc-ingest'), r('d', 'ui', true)]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('the linked-issue starter is conditional, and an adopted copy is offered the update (F21, operator Q3)', () => {
  const linked = STARTER_RULES.find((s) => s.id === 'learn-linked-issue')!;
  const OLD = 'Every pull request names the issue it closes in its description.';
  /** A copy as the store lists it: adopted from the OLD starter, then maybe changed by the team. */
  const copy = (over: Partial<ConformanceRule> = {}): ConformanceRule =>
    ({ ...starterRule(linked), statement: OLD, criteria: undefined, ...over }) as ConformanceRule;

  it('the starter reads conditionally, with criteria that make a no-issue job N/A, and still checks the delivery', () => {
    const r = starterRule(linked);
    expect(r.statement).toBe('When a pull request resolves a tracked issue, its description names it with a closing keyword (Fixes #N).');
    expect(r.criteria).toMatch(/^Not applicable when neither the job nor the pull request text names a tracked issue/u);
    expect(r.criteria).toContain('Broken when an issue the work resolves is named but the description does not close it');
    expect(r.obligations).toEqual(['evidence:delivery']);
    // Starters with no criteria carry none on the wire.
    expect('criteria' in starterRule(STARTER_RULES[0]!)).toBe(false);
  });

  it('offers the update for the old text verbatim, keeping every field the team set', () => {
    const mine = copy({ severity: 'error', applies_to: ['phase:deliver'], excludes: ['tool:mcp'], obligations: ['evidence:delivery', 'check:team-own'], weight: 2, targets: { project: 'pay' } } as Partial<ConformanceRule>);
    const next = starterUpdate(linked, [mine])!;
    expect(next).toEqual({ ...mine, statement: linked.statement, criteria: linked.criteria });
    // Surrounding whitespace is not an edit.
    expect(starterUpdate(linked, [copy({ statement: `  ${OLD}\n` })])).not.toBeNull();
  });

  it('never offers it for a copy anyone changed, a retired copy, a rule that is not the adopted starter, or the new text', () => {
    expect(starterUpdate(linked, [copy({ statement: 'Every pull request names the issue it closes in its description, always.' })])).toBeNull();
    expect(starterUpdate(linked, [copy({ statement: OLD.toLowerCase() })])).toBeNull();
    expect(starterUpdate(linked, [copy({ criteria: 'Strict: an issue for every pull request.' })])).toBeNull();
    expect(starterUpdate(linked, [copy({ retired: true })])).toBeNull();
    expect(starterUpdate(linked, [copy({ provenance: { source: 'doc-ingest', ref: 'CONTRIBUTING.md', source_kinds: ['doc'] } })])).toBeNull();
    // Each part of the starter's provenance alone: a copy re-sourced or re-kinded is not the adopted starter.
    expect(starterUpdate(linked, [copy({ provenance: { source: 'doc-ingest', ref: 'learn:starter', source_kinds: ['doc'] } })])).toBeNull();
    expect(starterUpdate(linked, [copy({ provenance: { source: 'ui', ref: 'learn:starter', source_kinds: ['code'] } })])).toBeNull();
    expect(starterUpdate(linked, [starterRule(linked)])).toBeNull();
    expect(starterUpdate(linked, [])).toBeNull();
    // A starter with no earlier text never offers one.
    expect(starterUpdate(STARTER_RULES[0]!, [starterRule(STARTER_RULES[0]!)])).toBeNull();
  });
});

describe('picking a starter never replaces the team’s copy (F21)', () => {
  const linked = STARTER_RULES.find((s) => s.id === 'learn-linked-issue')!;
  const edited = { ...starterRule(linked), statement: 'Every pull request names its Jira ticket.', severity: 'error', applies_to: ['phase:deliver'], weight: 3 } as ConformanceRule;

  it('a starter never adopted is written fresh; one in force writes nothing; a retired copy comes back exactly as it was', () => {
    expect(starterAdoption(linked, [])).toEqual(starterRule(linked));
    expect(starterAdoption(linked, [edited])).toBeNull();
    expect(starterAdoption(linked, [{ ...edited, retired: true }])).toEqual({ ...edited, retired: false });
    // A retired copy beside one in force: the one in force wins (nothing to write).
    expect(starterAdoption(linked, [{ ...edited, retired: true }, starterRule(linked)])).toBeNull();
  });
});

describe('Style (§3.1)', () => {
  const run = (status: string, unitIx: number, units = 3): Pick<SessionView, 'session' | 'units'> =>
    ({ session: { id: 'r', status, unit_ix: unitIx }, units: Array.from({ length: units }, (_, i) => ({ id: `u${i}`, ord: i })) } as unknown as SessionView);

  it('the stations follow the slowest job, and all four are done once decided', () => {
    expect(styleStations([], false)).toEqual(['wait', 'wait', 'wait', 'wait']);
    expect(styleStations([run('executing', 0)], false)).toEqual(['run', 'wait', 'wait', 'wait']);
    expect(styleStations([run('executing', 1)], false)).toEqual(['done', 'run', 'wait', 'wait']);
    expect(styleStations([run('executing', 2)], false)).toEqual(['done', 'done', 'run', 'wait']);
    expect(styleStations([run('awaiting_human', 2), run('executing', 0)], false)).toEqual(['run', 'wait', 'wait', 'wait']);
    expect(styleStations([run('awaiting_human', 2), run('completed', 3)], false)).toEqual(['done', 'done', 'done', 'run']);
    expect(styleStations([run('completed', 3)], true)).toEqual(['done', 'done', 'done', 'done']);
  });

  it('says what each job is doing, in words', () => {
    expect(jobLine({ runId: 'r', kind: 'repo', sources: ['web'] }, undefined)).toBe('Reading web: starting');
    expect(jobLine({ runId: 'r', kind: 'repo', sources: ['web'] }, run('executing', 1))).toBe('Reading web (step 2 of 3)');
    expect(jobLine({ runId: 'r', kind: 'rules', sources: ['CONTRIBUTING.md'] }, run('awaiting_human', 2))).toBe('Rules drafted from CONTRIBUTING.md: ready for you');
  });

  it('asks a repo job for the style lens, and a writing capture for memories only', () => {
    expect(repoStyleProblem('acme/web')).toContain('style lens of the repo-learn skill');
    const notes = writingStyleNotes(['blog', 'notes.md'], ['https://eng.example.com/blog']);
    expect(notes).toContain('MEMORY');
    expect(notes).toContain('File no rules');
    expect(notes).toContain('https://eng.example.com/blog');
  });
});

// Seen live on :7721 (ui-v3 round 2): git's "Last, First" name greeted as "Welcome, Parcewski," / "Hi Parcewski,.".
describe('firstNameOf', () => {
  it('greets by the given name, whichever order git holds it in', () => {
    expect(firstNameOf('Parcewski, Michael')).toBe('Michael');
    expect(firstNameOf('Ada Lovelace')).toBe('Ada');
    expect(firstNameOf('Grace')).toBe('Grace');
    expect(firstNameOf('Hopper,')).toBe('Hopper');
    expect(firstNameOf('  ')).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});
