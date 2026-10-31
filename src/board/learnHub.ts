import type { PersonaDial, PersonaHabit, PersonaInput } from '../api/learn.js';
import type { ConformanceRule, SessionView } from '../api/types.js';

/**
 * LEARN (program DES-LEARN §3-§4; the operator-approved mockup learn-and-panels states c and d). Pure:
 * where Learn sits in the sidebar, the first run's settings blob, the personality presets and preview,
 * the starter rules, and the Style pipeline's stations read from its jobs.
 */

// ── The first run's settings blob (`studio.firstRun`, the `studio.setup` mechanism) ─────────────

export const FIRST_RUN_KEY = 'studio.firstRun';

/** The six setup asks, in order. */
export const SETUP_ASKS = ['repos', 'agents', 'style', 'rules', 'persona', 'brand'] as const;
export type SetupAskKey = (typeof SETUP_ASKS)[number];

/** One answered setup ask: the record line it left, and whether it was done or put off. */
export interface SetupAnswer {
  line: string;
  done: boolean;
  /** The short words the "Your setup" row shows. */
  words: string;
}

export interface FirstRunState {
  /** Epoch ms of the first "use" of Learn (§3.0). Set once; Learn never moves back. */
  learnUsedAt?: number;
  /** Epoch ms the person chose "Ignore setup". Ignored, it never returns to Home. */
  ignoredAt?: number;
  /** Epoch ms the last setup ask was answered. */
  completedAt?: number;
  answers?: Partial<Record<SetupAskKey, SetupAnswer>>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function readFirstRun(settings: Record<string, unknown> | null | undefined): FirstRunState {
  const v = settings?.[FIRST_RUN_KEY];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const answers: Partial<Record<SetupAskKey, SetupAnswer>> = {};
  const raw = o['answers'];
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const k of SETUP_ASKS) {
      const a = (raw as Record<string, unknown>)[k];
      if (a === null || typeof a !== 'object') continue;
      const r = a as Record<string, unknown>;
      if (typeof r['line'] === 'string' && typeof r['words'] === 'string' && typeof r['done'] === 'boolean') {
        answers[k] = { line: r['line'], words: r['words'], done: r['done'] };
      }
    }
  }
  const learnUsedAt = num(o['learnUsedAt']);
  const ignoredAt = num(o['ignoredAt']);
  const completedAt = num(o['completedAt']);
  return {
    ...(learnUsedAt !== undefined ? { learnUsedAt } : {}),
    ...(ignoredAt !== undefined ? { ignoredAt } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
    ...(Object.keys(answers).length > 0 ? { answers } : {}),
  };
}

/** §3.0: Learn sits first in Work, above Projects, until it has been used; then below Evaluate, for good. */
export function learnPlacement(s: FirstRunState): 'start' | 'insight' {
  return s.learnUsedAt !== undefined ? 'insight' : 'start';
}

/** §4: Home shows the first run while it is neither ignored nor complete. */
export function firstRunOpen(s: FirstRunState): boolean {
  return s.ignoredAt === undefined && s.completedAt === undefined;
}

/** The next unanswered setup ask, or null when all six are answered. */
export function nextSetupAsk(s: FirstRunState): SetupAskKey | null {
  return SETUP_ASKS.find((k) => s.answers?.[k] === undefined) ?? null;
}

// ── Personality ─────────────────────────────────────────────────────────────────────────────

/** The personality's colour is DATA crew stores as `#rrggbb` (its avatar), not a theme colour. */
export const PERSONA_COLOURS: readonly { hex: string; name: string }[] = [
  // eslint-disable-next-line no-restricted-syntax -- persona colour is stored data (crew Persona.colour), not a token
  { hex: '#6366f1', name: 'Indigo' },
  // eslint-disable-next-line no-restricted-syntax -- persona colour is stored data (crew Persona.colour), not a token
  { hex: '#0d9488', name: 'Teal' },
  // eslint-disable-next-line no-restricted-syntax -- persona colour is stored data (crew Persona.colour), not a token
  { hex: '#c2410c', name: 'Rust' },
  // eslint-disable-next-line no-restricted-syntax -- persona colour is stored data (crew Persona.colour), not a token
  { hex: '#be185d', name: 'Berry' },
];

export const DIAL_WORDS: Record<keyof PersonaInput['dials'], { label: string; left: string; right: string }> = {
  length: { label: 'How much it says', left: 'Short', right: 'Thorough' },
  warmth: { label: 'Tone', left: 'Plain', right: 'Warm' },
  pushback: { label: 'Pushback', left: 'Goes along', right: 'Challenges' },
  initiative: { label: 'Initiative', left: 'Asks first', right: 'Just starts' },
};

export const HABIT_WORDS: Record<PersonaHabit, string> = {
  'says-unchecked': 'Says what it didn’t check',
  tables: 'Tables for comparisons',
  cites: 'Cites file and line',
  names: 'Calls me by name',
};

/** The three starting points first run offers, each a full personality. */
export const PERSONA_PRESETS: readonly { id: 'straight' | 'guide' | 'careful'; label: string; sub: string; persona: PersonaInput }[] = [
  {
    id: 'straight', label: 'Straight shooter', sub: 'short, plain, pushes back',
    persona: { name: 'Wren', colour: PERSONA_COLOURS[0]!.hex, dials: { length: 0, warmth: 0, pushback: 2, initiative: 1 }, habits: ['says-unchecked', 'cites'] },
  },
  {
    id: 'guide', label: 'Friendly guide', sub: 'warm, explains its steps',
    persona: { name: 'Wren', colour: PERSONA_COLOURS[1]!.hex, dials: { length: 2, warmth: 2, pushback: 1, initiative: 1 }, habits: ['names'] },
  },
  {
    id: 'careful', label: 'Careful reviewer', sub: 'thorough, cites everything',
    persona: { name: 'Wren', colour: PERSONA_COLOURS[2]!.hex, dials: { length: 2, warmth: 0, pushback: 2, initiative: 0 }, habits: ['says-unchecked', 'tables', 'cites'] },
  },
];

/** A fresh personality before one is saved: the straight shooter. */
export const DEFAULT_PERSONA: PersonaInput = PERSONA_PRESETS[0]!.persona;

/** The preview's three sample questions. */
export const PREVIEW_QUESTIONS = ['The build on main failed. What now?', 'Add dark mode to the settings page.', 'What happened today?'] as const;

/** One block of a preview answer. */
export type PreviewBlock =
  | { kind: 'p'; text: string; cite?: string }
  | { kind: 'steps'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'quiet'; text: string };

/**
 * How the orchestrator would answer a sample question with these settings. A sample, worded here: it
 * shows the effect of each dial and habit, the same settings the voice block sends (crew `persona/voice.ts`).
 */
export function previewAnswer(p: PersonaInput, q: 0 | 1 | 2, person: string | null): PreviewBlock[] {
  const { length: L, warmth: W, pushback: P, initiative: I } = p.dials;
  const has = (h: PersonaHabit): boolean => p.habits.includes(h);
  const name = has('names') && person !== null && person !== '' ? person.split(/\s+/u)[0]! : null;
  const greet = (warm: string): string => (W === 2 ? `${warm}${name !== null ? `, ${name}` : ''}! ` : name !== null ? `${name}, ` : '');
  const out: PreviewBlock[] = [];
  if (q === 0) {
    out.push({ kind: 'p', text: `${greet('Good catch')}Main is red: 2 tests in retry_policy.test.ts fail on the jitter bound.`, ...(has('cites') ? { cite: 'src/webhooks/retry_policy.ts:44' } : {}) });
    if (P === 2) out.push({ kind: 'p', text: 'The same test was skipped last week instead of fixed. I’d rather fix the bound than skip it again.' });
    else if (P === 1) out.push({ kind: 'p', text: 'It looks like a real bug, not a flaky test.' });
    out.push({ kind: 'p', text: I === 2 ? 'I’ve started “Fix the jitter bound”. It waits for your review before it merges.' : I === 1 ? 'I can start a fix job now; it waits for your review. Go?' : 'Do you want me to look into it, or will you?' });
    if (L === 2) out.push({ kind: 'steps', items: ['Reproduce on a clean checkout', 'Clamp the delay to the 10 min cap', 'Add a property test for the bound'] });
    if (has('says-unchecked')) out.push({ kind: 'quiet', text: 'Not checked: whether the Windows runner shows the same failure.' });
  } else if (q === 1) {
    out.push({ kind: 'p', text: `${W === 2 ? `${greet('Love it')}` : name !== null ? `${name}, ` : ''}Settings already reads the theme from useAppearance, so this is mostly a toggle and two colour sets.`, ...(has('cites') ? { cite: 'src/settings/Appearance.tsx:12' } : {}) });
    if (P === 2) out.push({ kind: 'p', text: 'One push back: 9 components hard-code colours. Dark mode will look broken there unless we fix those first. I’d include them.' });
    else if (P === 1) out.push({ kind: 'p', text: '9 components hard-code colours; those need a pass too.' });
    if (has('tables') || L === 2) out.push({ kind: 'table', head: ['Option', 'Size', 'Risk'], rows: [['Toggle only', 'small', 'broken spots'], ['Toggle + 9 fixes', 'medium', 'low']] });
    out.push({ kind: 'p', text: I === 2 ? 'Starting it as a feature job with the 9 fixes; the plan waits for your OK.' : I === 1 ? 'Want the bigger version?' : 'Which version do you want?' });
  } else {
    out.push({ kind: 'p', text: `${greet('A good day')}4 jobs finished, 3 delivered as pull requests, and 1 waits on you: the webhook retries are ready to deliver.` });
    if (L >= 1) out.push({ kind: 'p', text: 'Codex caught a missing idempotency key in the refunds job before it shipped.' });
    if (L === 2) out.push({ kind: 'p', text: 'Spend was $11.40, most of it the refunds review. Nothing failed.' });
    if (P === 2) out.push({ kind: 'p', text: 'One thing I don’t like: the QE pass rate is 29% this week. Worth a look in Evaluate.' });
    if (has('says-unchecked')) out.push({ kind: 'quiet', text: 'Not counted: jobs still running (1).' });
  }
  // Short: the answer and one more line, never the extras.
  // Short: the sentences only, never the steps or the table.
  return L === 0 ? out.filter((b) => b.kind !== 'steps' && b.kind !== 'table') : out;
}

export function clampDial(n: number): PersonaDial {
  return (n <= 0 ? 0 : n >= 2 ? 2 : 1) as PersonaDial;
}

// ── Starter rules (§3.2): real steering rules, adopted by picking them ─────────────────────────

export interface StarterRule {
  id: string;
  title: string;
  line: string;
  type: NonNullable<ConformanceRule['steering_type']>;
  statement: string;
}

export const STARTER_RULES: readonly StarterRule[] = [
  { id: 'learn-small-prs', title: 'Small pull requests', line: 'One concern; under 400 changed lines', type: 'development', statement: 'A pull request carries one concern and stays under 400 changed lines; split anything larger.' },
  { id: 'learn-tests-with-fixes', title: 'Tests with every fix', line: 'A failing test first, then the fix', type: 'testing', statement: 'A bug fix includes a test that fails without the fix.' },
  { id: 'learn-no-secrets', title: 'No secrets in code', line: 'Keys and tokens come from the environment', type: 'security', statement: 'No key, token or password is written in code, config or tests; secrets come from the environment.' },
  { id: 'learn-linked-issue', title: 'Linked issue', line: 'Every PR names the issue it closes', type: 'development', statement: 'Every pull request names the issue it closes in its description.' },
  { id: 'learn-accessible', title: 'Accessible by default', line: 'Labels, focus and contrast on every screen', type: 'design-ux', statement: 'Every new screen has labelled controls, a visible focus and text contrast of at least 4.5:1.' },
  { id: 'learn-reversible-migrations', title: 'Migrations are reversible', line: 'Every schema change has a down step', type: 'operations', statement: 'Every schema migration has a tested down step.' },
];

/** The steering rule a starter adopts (provenance `ui`, `ref: learn:starter`). */
export function starterRule(s: StarterRule): ConformanceRule {
  return {
    id: s.id,
    rule_type: 'policy',
    statement: s.statement,
    severity: 'warn',
    confidence: 0.9,
    targets: {},
    provenance: { source: 'ui', ref: 'learn:starter', source_kinds: ['doc'] },
    steering_type: s.type,
    applies_to: [],
    excludes: [],
    weight: 1.0,
  } as ConformanceRule;
}

/** Rules a person added or adopted (by hand, a starter, a chat or a Learn run), not built in or imported. */
export function rulesYouCareAbout(rules: readonly ConformanceRule[]): ConformanceRule[] {
  return rules.filter((r) => r.retired !== true && (r.provenance.source === 'ui' || r.provenance.source === 'chat'));
}

// ── Style: sources and the pipeline (§3.1) ───────────────────────────────────────────────────

export type StyleKind = 'doc' | 'repo' | 'writing' | 'topic';

export const STYLE_KIND_WORDS: Record<StyleKind, string> = {
  doc: 'Team doc',
  repo: 'Showcase repo',
  writing: 'Writing',
  topic: 'Topic to follow',
};

/** One source in the Style list. A doc or writing carries its text (a dropped file) or a link. */
export interface StyleSource {
  id: string;
  kind: Exclude<StyleKind, 'topic'>;
  label: string;
  /** A registered repository's id (kind `repo`). */
  repoId?: string;
  /** A dropped file's text (kind `doc` / `writing`), kept in memory only. */
  text?: string;
  /** A link (kind `writing`, or a doc given as a URL). */
  url?: string;
}

/** The job a Style source runs as (§3.1): team docs → steering-author; repos → capture-learnings with the
 *  style lens; writing → a capture (memories in the person's voice). */
export type StyleJobKind = 'rules' | 'repo' | 'writing';

export interface StyleJob {
  runId: string;
  kind: StyleJobKind;
  /** The sources it reads, by label. */
  sources: string[];
}

/** The problem a showcase repo's capture-learnings job is launched with (garden repo-learn's style lens). */
export function repoStyleProblem(repoName: string): string {
  return `Learn the style of ${repoName}: how this team works, not only how the code works. Use the style lens of the repo-learn skill (naming, structure, test shape, change size, commit and review tone) and capture what you find as style memories for review.`;
}

/** The notes a writing source is captured with. */
export function writingStyleNotes(labels: readonly string[], urls: readonly string[]): string {
  return [
    'Learn how I write from this material: it is my own writing, handed over as an example of my voice.',
    'Read a bounded sample (at most 10 pages, public addresses only) and file each pattern you find (sentence length, voice, person, how pieces open and end, jargon, headings against prose) as a MEMORY about how I work (reach operator). File no rules and no intents.',
    ...(urls.length > 0 ? ['', 'Links:', ...urls.map((u) => `- ${u}`)] : []),
    ...(labels.length > urls.length ? ['', `Files: ${labels.filter((l) => !urls.includes(l)).join(', ')}`] : []),
  ].join('\n');
}

/** The instructions a team-docs steering-author job is launched with. */
export const TEAM_DOCS_INSTRUCTIONS =
  'Turn these team documents into steering rules: the conventions they say people must or should follow (branching, pull requests, reviews, testing, design principles). One rule per convention, each citing the document and line or page it comes from. Do not invent rules the documents do not state.';

export type StationState = 'wait' | 'run' | 'done';

/** The four stations (Read → Spot patterns → Draft → You decide), from the jobs' runs. */
export function styleStations(runs: readonly Pick<SessionView, 'session' | 'units'>[], decided: boolean): [StationState, StationState, StationState, StationState] {
  if (runs.length === 0) return ['wait', 'wait', 'wait', 'wait'];
  if (decided) return ['done', 'done', 'done', 'done'];
  // Each run's progress as a fraction of its units; the slowest job sets the pace.
  const progress = runs.map((r) => {
    const total = Math.max(1, r.units.length);
    const ended = ['completed', 'awaiting_human', 'failed', 'cancelled'].includes(r.session.status);
    return ended ? 1 : Math.min(0.99, r.session.unit_ix / total);
  });
  const p = Math.min(...progress);
  if (p >= 1) return ['done', 'done', 'done', 'run'];
  if (p >= 2 / 3) return ['done', 'done', 'run', 'wait'];
  if (p >= 1 / 3) return ['done', 'run', 'wait', 'wait'];
  return ['run', 'wait', 'wait', 'wait'];
}

/** The ticker's line for a job: what it is doing in words. */
export function jobLine(job: StyleJob, run: Pick<SessionView, 'session' | 'units'> | undefined): string {
  const what = job.kind === 'rules' ? 'Drafting rules from' : job.kind === 'repo' ? 'Reading' : 'Reading your writing in';
  const src = job.sources.join(', ');
  if (run === undefined) return `${what} ${src}: starting`;
  const s = run.session.status;
  if (s === 'awaiting_human') return job.kind === 'rules' ? `Rules drafted from ${src}: ready for you` : `${src}: waiting for you`;
  if (s === 'completed') return `${src}: done`;
  if (s === 'failed') return `${src}: the job failed`;
  if (s === 'cancelled') return `${src}: cancelled`;
  const total = run.units.length;
  return `${what} ${src}${total > 0 ? ` (step ${Math.min(run.session.unit_ix + 1, total)} of ${total})` : ''}`;
}

// ── First run (§4): what we know, and the asks ────────────────────────────────────────────────

/** Mail hosts that say nothing about the person's organisation: no "your site" from these. */
const PUBLIC_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'mac.com',
  'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'fastmail.com', 'hey.com', 'users.noreply.github.com', 'example.com',
]);

/** The website a git email suggests (`sam@acme.dev` → `acme.dev`), or null for a public mail host or no email. */
export function siteOfEmail(email: string | null | undefined): string | null {
  const domain = email?.split('@')[1]?.trim().toLowerCase() ?? '';
  if (domain === '' || !/^[a-z0-9.-]+\.[a-z]{2,}$/u.test(domain)) return null;
  if (PUBLIC_MAIL.has(domain) || [...PUBLIC_MAIL].some((d) => domain.endsWith(`.${d}`))) return null;
  return domain;
}

/** "62% · 21% · 9%" style shares, rounded, for at most `n` languages. */
export function shareWords(langs: readonly { share: number }[], n = 3): string {
  return langs.slice(0, n).map((l) => `${Math.round(l.share * 100)}%`).join(' · ');
}
