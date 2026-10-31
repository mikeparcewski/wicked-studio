import { describe, expect, it } from 'vitest';
import {
  firstNameOf, firstRunOpen, learnPlacement, nextSetupAsk, PERSONA_PRESETS, previewAnswer, readFirstRun, rulesYouCareAbout, siteOfEmail,
  STARTER_RULES, starterRule, styleStations, writingStyleNotes, jobLine, repoStyleProblem,
} from '../src/board/learnHub.js';
import { LEARN_ITEM, navCurrent, navGroups, NAV_GROUPS } from '../src/board/navModel.js';
import type { ConformanceRule, SessionView } from '../src/api/types.js';

/** program DES-LEARN §3-§4, the pure half: where Learn sits, the first run's blob, the persona preview, starters, Style. */

describe('Learn in the sidebar (§3.0)', () => {
  it('sits first in Work, above Projects and marked, until used; then last in Insight, below Evaluate, unmarked', () => {
    const start = navGroups('start');
    expect(start.find((g) => g.id === 'work')!.items.map((i) => i.id)).toEqual(['learn', 'projects', 'jobs', 'repos']);
    expect(start.find((g) => g.id === 'work')!.items[0]!.mark).toBe('Start here');
    expect(start.find((g) => g.id === 'insight')!.items.map((i) => i.id)).toEqual(['report', 'understand', 'evaluate']);
    const used = navGroups('insight');
    expect(used.find((g) => g.id === 'insight')!.items.map((i) => i.id)).toEqual(['report', 'understand', 'evaluate', 'learn']);
    expect(used.find((g) => g.id === 'insight')!.items.at(-1)!.mark).toBeUndefined();
    expect(used.find((g) => g.id === 'work')!.items.map((i) => i.id)).toEqual(['projects', 'jobs', 'repos']);
    // The constant groups are untouched (Learn is placed by navGroups only).
    expect(NAV_GROUPS.flatMap((g) => g.items).some((i) => i.id === 'learn')).toBe(false);
  });

  it('is the current page under /learn', () => {
    expect(navCurrent('/learn')).toBe('learn');
    expect(LEARN_ITEM.path).toBe('/learn');
  });

  it('moves once used, and never back (used = learnUsedAt set)', () => {
    expect(learnPlacement({})).toBe('start');
    expect(learnPlacement({ learnUsedAt: 1 })).toBe('insight');
    expect(learnPlacement({ learnUsedAt: 1, ignoredAt: 2 })).toBe('insight');
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
