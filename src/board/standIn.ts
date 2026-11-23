/**
 * THE STAND-IN CHOICE (DES-STANDIN-001 rev 3, studio stage S0; Refs wicked-core#1843).
 *
 * When too few helpers are signed in to check a job (a reviewer, judge or council member must not be the helper that
 * built the work), crew refuses the launch BEFORE anything is created and asks the person instead:
 * `409 { code: 'stand_in_choice', preflight, choices, retryWith }` (DES §4, body in §5.2). This module reads that
 * refusal and words it for someone seeing it for the first time; `StandInChoice` draws it.
 *
 * Wire shapes are LOCAL COMPATIBILITY TYPES copied from the DES (§3.9 `IndependencePreflight`, §5.2
 * `StandInChoiceRefusal`): studio pins wicked-crew-api-types 0.216.0, and the types ship in K1 after this stage
 * (DES §8, S0 row). S1 swaps these for the published api-types.
 *
 * Words: the person reads "helper" and "stand-in", never the engine's terms. Every check a stand-in does is
 * labelled as one, and a stand-in is never called a check by a different helper (DES §2).
 * Pure; the settings write lives in `saveStandInsEveryJob`.
 */
import { ApiError } from '../api/errors.js';
import { api } from '../api/client.js';
import { cliLabel } from '../api/skillUsage.js';
import type { LaunchBodyWithDeliver } from '../api/types.js';
import { seatLabel, type SeatNameInput } from './seatNames.js';

/** The refusal's code (DES §4: `short && canStandIn && !consent` → `409 stand_in_choice`). */
export const STAND_IN_CHOICE_CODE = 'stand_in_choice';

/** DES §3.1 wire tokens (§5.2 `IndependentRole`, an open union). */
export type IndependentRole = 'evaluator' | 'judge' | 'rule_judge' | 'qe_reviewer' | 'council' | 'monitor' | 'party_excluded' | (string & {});

/** One role the job may need, as the preflight counted it (DES §3.9 `roles[]`). */
export interface PreflightRole {
  role: IndependentRole;
  needed: number;
  real: string[];
  shortBy: number;
  canStandIn: boolean;
  standInFrom: { cli: string; models: (string | null)[] } | null;
  conditional: boolean;
  why: string | null;
}

/** DES §3.9 `IndependencePreflight`. `judges` and `diversity` are diagnostics this card does not read. */
export interface IndependencePreflight {
  short: boolean;
  primary: string | null;
  roles: PreflightRole[];
  reason: string | null;
  signedIn: string[];
  benched: Array<{ seat: string; reason: string; detail?: string }>;
  judges?: unknown[];
  diversity?: unknown;
}

/** DES §5.2 choice ids. */
export type StandInChoiceId = 'job' | 'always' | 'sign_in' | 'cancel';
const CHOICE_IDS: readonly StandInChoiceId[] = ['job', 'always', 'sign_in', 'cancel'];

/** DES §5.2 `StandInChoiceRefusal`. */
export interface StandInChoiceRefusal {
  code: typeof STAND_IN_CHOICE_CODE;
  error: string;
  preflight: IndependencePreflight;
  choices: Array<{ id: StandInChoiceId; label: string }>;
  retryWith: { standIns: true };
}

/** The launch body a "this job" answer sends: §5.2 `LaunchRunBody += standIns?: boolean` (local until K1). */
export type StandInLaunchBody = LaunchBodyWithDeliver & { standIns?: true };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function roleOf(v: unknown): PreflightRole | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o['role'] !== 'string') return null;
  const from = o['standInFrom'] as Record<string, unknown> | null | undefined;
  return {
    role: o['role'],
    needed: count(o['needed']),
    real: strings(o['real']),
    shortBy: count(o['shortBy']),
    canStandIn: o['canStandIn'] === true,
    standInFrom: typeof from === 'object' && from !== null && typeof from['cli'] === 'string'
      ? { cli: from['cli'], models: Array.isArray(from['models']) ? from['models'].map((m) => (typeof m === 'string' ? m : null)) : [] }
      : null,
    conditional: o['conditional'] === true,
    why: typeof o['why'] === 'string' ? o['why'] : null,
  };
}

/**
 * The stand-in choice a launch refusal carries, or `null` when `e` is any other refusal (it keeps today's error line).
 * Only the listed choices this studio knows are kept, in crew's order; a body with none of them, or with no
 * `retryWith` to re-send, is not a choice studio can offer.
 */
export function standInChoiceOf(e: unknown): StandInChoiceRefusal | null {
  if (!(e instanceof ApiError) || e.status !== 409 || typeof e.body !== 'object' || e.body === null) return null;
  const b = e.body as Record<string, unknown>;
  if (b['code'] !== STAND_IN_CHOICE_CODE) return null;
  const p = b['preflight'] as Record<string, unknown> | null | undefined;
  const retry = b['retryWith'] as Record<string, unknown> | null | undefined;
  if (typeof p !== 'object' || p === null || !Array.isArray(p['roles'])) return null;
  if (typeof retry !== 'object' || retry === null || retry['standIns'] !== true) return null;
  const seen = new Set<StandInChoiceId>();
  const choices: StandInChoiceRefusal['choices'] = [];
  for (const c of Array.isArray(b['choices']) ? b['choices'] : []) {
    const id = (c as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !(CHOICE_IDS as readonly string[]).includes(id) || seen.has(id as StandInChoiceId)) continue;
    seen.add(id as StandInChoiceId);
    const label = (c as { label?: unknown }).label;
    choices.push({ id: id as StandInChoiceId, label: typeof label === 'string' ? label : '' });
  }
  if (choices.length === 0) return null;
  return {
    code: STAND_IN_CHOICE_CODE,
    error: typeof b['error'] === 'string' ? b['error'] : '',
    preflight: {
      short: p['short'] === true,
      primary: typeof p['primary'] === 'string' ? p['primary'] : null,
      roles: (p['roles'] as unknown[]).map(roleOf).filter((r): r is PreflightRole => r !== null),
      reason: typeof p['reason'] === 'string' ? p['reason'] : null,
      signedIn: strings(p['signedIn']),
      benched: Array.isArray(p['benched']) ? (p['benched'] as IndependencePreflight['benched']) : [],
    },
    choices,
    retryWith: { standIns: true },
  };
}

/**
 * "This job": the request the form sends, with crew's `retryWith` (DES §5.2, §6). The forms build it through their own
 * launch path at the moment of the choice, so an unedited form re-sends the refused request field for field and an
 * edited one sends what it shows (nothing is replayed from the refused attempt).
 */
export function standInRelaunchBody(sent: LaunchBodyWithDeliver, refusal: StandInChoiceRefusal): StandInLaunchBody {
  return { ...sent, ...refusal.retryWith };
}

// ── Words ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A helper's name as the rest of studio says it: the roster's name, else its family's ("codex#2" → "Codex (2)"). */
export function helperNamer(roster: readonly SeatNameInput[] | null | undefined): (cli: string) => string {
  return (cli) => {
    const seat = (roster ?? []).find((s) => s.key === cli);
    return seat !== undefined ? seatLabel(seat) : cliLabel(cli);
  };
}

/** What one short role is called on the card (DES §2.1: reviewer, judge, QE reviewer, council). */
function roleWords(r: PreflightRole): string {
  switch (r.role) {
    case 'evaluator': case 'party_excluded': return 'a reviewer';
    case 'judge': return 'a judge';
    case 'qe_reviewer': return 'a QE reviewer';
    case 'rule_judge': return 'a rules checker';
    case 'council': return `a council of ${Math.max(r.needed, 1)}`;
    case 'monitor': return r.needed > 1 ? `${r.needed} helpers to watch the team's work` : "a helper to watch the team's work";
    default: return 'another check';
  }
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs.filter((x) => x.trim() !== ''))];

/** "A disagreement would need 1 stand-in" / "… 3 stand-ins". */
function standInsWord(n: number): string {
  return `A disagreement would need ${n} ${n === 1 ? 'stand-in' : 'stand-ins'}`;
}

/** One choice as the card draws it: the button, and what happens next. */
export interface StandInChoiceLine {
  id: StandInChoiceId;
  label: string;
  next: string;
}

export interface StandInChoiceWords {
  title: string;
  /** Who is signed in, and what the job needs that they can't give. */
  why: string;
  /** What a stand-in is (the same tool, in a separate session). */
  meaning: string;
  /** What the record says. */
  record: string;
  choices: StandInChoiceLine[];
}

/** What each choice does, said on the card (studio's words: crew's `label` is not shown, so no internal term can). */
const CHOICE_WORDS: Readonly<Record<StandInChoiceId, readonly [string, string]>> = {
  job: ['Use stand-ins for this job', 'Starts this job now. You will be asked again next time.'],
  always: ['Use stand-ins for every job', 'Starts this job now and stops asking. You can change this later in Settings.'],
  sign_in: ['Sign in another helper', 'Opens Helpers. Nothing starts; start the job again once another helper is signed in.'],
  cancel: ['Cancel', 'Nothing starts. What you wrote is kept.'],
};

/**
 * The card's words for a refusal. `name` turns a helper key into its name the way the rest of studio does
 * ("claude" → "Claude Code"; the launch form passes its roster's `seatLabel`).
 */
export function standInChoiceWords(r: StandInChoiceRefusal, name: (cli: string) => string): StandInChoiceWords {
  const signedIn = uniq(r.preflight.signedIn.map(name));
  const short = r.preflight.roles.filter((x) => x.shortBy > 0);
  const firm = uniq(short.filter((x) => !(x.conditional && x.role === 'council')).map(roleWords));
  const councils = short.filter((x) => x.conditional && x.role === 'council');
  const council = councils.length > 0 ? `a council of ${Math.max(...councils.map((c) => Math.max(c.needed, 1)))} if a disagreement comes up` : null;

  const title = signedIn.length === 1 ? 'Only one helper can check this job'
    : firm.length === 0 && councils.length > 0 ? standInsWord(Math.max(...councils.map((c) => c.shortBy)))
      : 'Not enough helpers can check this job';

  const who = signedIn.length === 0 ? 'No other helper is signed in.'
    : signedIn.length === 1 ? `${signedIn[0]!} is the only helper signed in.`
      : `${listWords(signedIn)} are signed in.`;
  const needs = firm.length > 0
    ? `This job needs ${listWords(firm)} that did not build the work${council !== null ? `, and ${council}` : ''}.`
    : council !== null
      ? 'If a disagreement comes up, it goes to a council of helpers that did not build or review the work.'
      : 'This job needs checks by helpers that did not build the work.';
  const enough = signedIn.length > 1 ? ' There are not enough of them left for that.' : '';

  const bases = uniq(short.filter((x) => x.canStandIn && x.standInFrom !== null).map((x) => name(x.standInFrom!.cli)));
  const models = uniq(short.flatMap((x) => (x.canStandIn ? x.standInFrom?.models ?? [] : [])).filter((m): m is string => m !== null));
  const tool = bases.length > 0 ? listWords(bases) : signedIn.length === 1 ? signedIn[0]! : 'a signed-in helper';
  const meaning = `wicked can fill ${short.length === 1 && council === null ? 'that role' : 'those roles'} with stand-ins. `
    + `A stand-in is ${tool} again, in a separate, fresh session: it sees the work but none of the builder's reasoning`
    + `${models.length > 0 ? `, and it runs on the ${models.join(' or ')} model where it can` : ''}.`;
  const record = 'The job, every check, the delivery and the pull request will say a stand-in did the check. '
    + 'It is never counted as a check by a different helper.';

  return {
    title,
    why: `${who} ${needs}${enough}`,
    meaning,
    record,
    choices: r.choices.map((c) => ({ id: c.id, label: CHOICE_WORDS[c.id][0], next: CHOICE_WORDS[c.id][1] })),
  };
}

// ── "Every job" ───────────────────────────────────────────────────────────────────────────────────────────────────

/** DES §4 `SystemSettings.standInReview` (local until K1). */
export type StandInReview = 'ask' | 'always';

/**
 * "Every job": turn the setting on (DES §2.1 step 3, §4), then the caller sends the request again without
 * `standIns`, so crew takes consent from the setting (scope `always`; a request flag would record `job`). The answer
 * must echo the setting, or nothing is launched: a service that drops the key would refuse the same way again.
 */
export async function saveStandInsEveryJob(): Promise<void> {
  const out = await api.updateSettings({ standInReview: 'always' } as never);
  const saved = (out as { settings?: { standInReview?: unknown } } | null)?.settings?.standInReview;
  if (saved !== 'always') throw new Error('This service did not save “use stand-ins for every job”, so nothing started. Choose “Use stand-ins for this job” instead.');
}
