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
import type { LaunchBodyWithDeliver } from '../api/types.js';
import { cliLabel, seatKeyName, standInBase, type SeatNameInput } from './seatNames.js';

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
  return (cli) => seatKeyName(cli, roster, cliLabel);
}

/** What one short role is called on the card, by what it does (DES §2.1 roles; coord round 2: no insider words). */
function roleWords(r: PreflightRole): string {
  switch (r.role) {
    case 'evaluator': case 'party_excluded': return 'a reviewer';
    case 'judge': return 'a judge';
    case 'qe_reviewer': return 'a tester who checks the result does what you asked';
    case 'rule_judge': return 'a rules checker';
    case 'council': return `a council of ${Math.max(r.needed, 1)}`;
    case 'monitor': return r.needed > 1 ? `${r.needed} helpers to watch the team's work` : "a helper to watch the team's work";
    default: return 'another check';
  }
}

/** "a", "a and b", "a, b, and c": the last comma keeps a long item ("a tester who checks …") from running into the next. */
export function listWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]!} and ${items[1]!}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]!}`;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs.filter((x) => x.trim() !== ''))];

/** (coord N5 on wicked-crew#1932) The roles a stand-in fills: the engine's one fill site is the review's distribution
 *  (a reviewer, the party-excluded review), plus the judge's and the QE reviewer's holds. None sits on a council, watches
 *  the team or checks the rules. */
const STAND_IN_ROLES: ReadonlySet<string> = new Set(['evaluator', 'party_excluded', 'judge', 'qe_reviewer']);

/**
 * A choice the card draws: crew's ids, plus studio's `pick` (studio#1436), which stands in crew's `sign_in` place when
 * a helper that could check the job is signed in and only not picked for it. The host form opens its helper options.
 */
export type StandInChoiceLineId = StandInChoiceId | 'pick';

/** One choice as the card draws it: the button, and what happens next. */
export interface StandInChoiceLine {
  id: StandInChoiceLineId;
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
const PICK_WORDS: readonly [string, string] = ['Pick another helper', 'Opens this job\'s helpers. Nothing starts; turn another helper on, then start the job again.'];

/**
 * The card's words for a refusal. `name` turns a helper key into its name the way the rest of studio does
 * ("claude" → "Claude Code"; the launch form passes its roster's `seatLabel`).
 *
 * `signedInNow`: the keys of the helpers the form offers that can take work now (signed in, not benched). On a launch
 * the preflight's `signedIn` is the launch's own helpers, the ones picked for this job (wicked-core `independence.rs`
 * `IndependencePreflight.signed_in`), so a helper here and not there (nor benched) is signed in but not picked (studio#1436). Then the
 * card says "picked", names those helpers, and offers to pick one (`pick`) where crew's `sign_in` was. Absent or with
 * nothing more: the card says who is signed in, as before.
 */
export function standInChoiceWords(r: StandInChoiceRefusal, name: (cli: string) => string, signedInNow?: readonly string[] | undefined): StandInChoiceWords {
  // A helper the preflight benched is out of work for now: not one to pick.
  const launchKeys = new Set([...r.preflight.signedIn, ...r.preflight.benched.map((b) => b.seat)]);
  const signedIn = uniq(r.preflight.signedIn.map(name));
  const unpicked = uniq((signedInNow ?? []).filter((k) => !launchKeys.has(k)).map(name));
  const picked = unpicked.length > 0;
  // (wicked-crew#1932, coord N5) The card names the short roles a stand-in fills, and only those: a short council,
  // monitor or rules check is met by the run as it would be with no stand-ins. A crew that asks for those alone (before
  // wicked-crew#1936) is told so, and no stand-in is promised.
  const shortAll = r.preflight.roles.filter((x) => x.shortBy > 0);
  const fillable = shortAll.filter((x) => STAND_IN_ROLES.has(x.role));
  const short = fillable.length > 0 ? fillable : shortAll;
  const firm = uniq(short.filter((x) => x.role !== 'council').map(roleWords));
  const councils = short.filter((x) => x.role === 'council');
  const council = councils.length > 0 ? `a council of ${Math.max(...councils.map((c) => Math.max(c.needed, 1)))} if a disagreement comes up` : null;

  const title = signedIn.length === 1 ? (picked ? 'Only one helper is picked for this job' : 'Only one helper can check this job')
    : picked ? 'Not enough helpers are picked for this job' : 'Not enough helpers can check this job';

  const who = picked
    ? signedIn.length === 0 ? 'No helper picked for this job can take work now.'
      : signedIn.length === 1 ? `Only ${signedIn[0]!} is picked for this job.` : `${listWords(signedIn)} are picked for this job.`
    : signedIn.length === 0 ? 'No other helper is signed in.'
      : signedIn.length === 1 ? `${signedIn[0]!} is the only helper signed in.`
        : `${listWords(signedIn)} are signed in.`;
  const needs = firm.length > 0
    ? `This job needs checks by helpers that did not build the work: ${listWords(firm)}${council !== null ? `, plus ${council}` : ''}.`
    : council !== null
      ? 'If a disagreement comes up, it goes to a council of helpers that did not build or review the work.'
      : 'This job needs checks by helpers that did not build the work.';
  const enough = signedIn.length > 1 ? ' There are not enough of them left for that.' : '';
  const pick = !picked ? ''
    : unpicked.length === 1 ? ` ${unpicked[0]!} is signed in but not picked: pick it to have the work checked by a helper that did not build it.`
      : ` ${listWords(unpicked)} are signed in but not picked: pick them to have the work checked by helpers that did not build it.`;

  const bases = uniq(short.filter((x) => x.canStandIn && x.standInFrom !== null).map((x) => name(x.standInFrom!.cli)));
  const tool = bases.length > 0 ? listWords(bases) : signedIn.length === 1 ? signedIn[0]! : 'a signed-in helper';
  const meaning = fillable.length === 0
    ? `${councils.length === short.length ? 'No stand-in sits on a council.' : `No stand-in does ${short.length === 1 ? 'that check' : 'those checks'}.`} `
      + 'Starting the job anyway runs it with the helpers it has.'
    : `wicked can fill ${short.length === 1 ? 'that role' : 'those roles'} with stand-ins. `
      // No model is named: studio names no model anywhere on screen (coord round 2 on #1361).
      + `A stand-in is ${tool} again, in a separate, fresh session: it sees the work but none of the builder's reasoning.`;
  const record = 'The job, every check, the delivery and the pull request will say a stand-in did the check. '
    + 'It is never counted as a check by a different helper.';

  return {
    title,
    why: `${who} ${needs}${enough}${pick}`,
    meaning,
    record,
    choices: r.choices.map((c) => (c.id === 'sign_in' && picked
      ? { id: 'pick', label: PICK_WORDS[0], next: PICK_WORDS[1] }
      : { id: c.id, label: CHOICE_WORDS[c.id][0], next: CHOICE_WORDS[c.id][1] })),
  };
}

// ── "Every job" ───────────────────────────────────────────────────────────────────────────────────────────────────

/** What the card says when "every job" could not be saved (refused, or not kept): one sentence for both. */
export const SETTINGS_NOT_SAVED = 'Settings could not be saved, so nothing started. Choose “Use stand-ins for this job” instead, or try again.';

/** DES §4 `SystemSettings.standInReview` (local until K1). */
export type StandInReview = 'ask' | 'always';

/**
 * "Every job": turn the setting on (DES §2.1 step 3, §4), then the caller sends the request again without
 * `standIns`, so crew takes consent from the setting (scope `always`; a request flag would record `job`). The answer
 * must echo the setting, or nothing is launched: a service that drops the key would refuse the same way again.
 */
export async function saveStandInsEveryJob(): Promise<void> {
  const out = await api.updateSettings({ standInReview: 'always' } as never).catch(() => null);
  const saved = (out as { settings?: { standInReview?: unknown } } | null)?.settings?.standInReview;
  if (saved !== 'always') throw new Error(SETTINGS_NOT_SAVED);
}

// ── A run's seated stand-ins (wicked-core#1930 F8, studio#1437) ─────────────────────────────────────────────────────

/** One seated stand-in as the run's wire says it. */
export interface SeatedStandIn {
  /** The seat key (`claude~1`). */
  key: string;
  /** "Claude Code (stand-in)": the wire's `display`, else the base seat's name. */
  name: string;
  /** The engine's sentence: "Claude Code stood in for the review, using …". Null on a read that carries none. */
  label: string | null;
  /** The role it stood in for (`evaluator`, `judge`, …), as the wire names it; null when no record says. */
  role: string | null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function rec(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * The run's seated stand-ins, by seat key (GET /runs/:id): `session.assurance.standIns[]` (`key`, `display`, `role`)
 * and each unit's `assurance.roles[]` with a `standIn` (`cli`, `label`). The session's unkeyed `standInLabel` is the
 * review's sentence: it labels the evaluator stand-in only when exactly one is seated and no role carried its own. A
 * unit seat with the reserved stand-in separator is named a stand-in even with no record (never the bare `claude~1`).
 * Pure.
 */
export function seatedStandIns(view: { session: unknown; units: readonly unknown[] } | null | undefined, roster?: readonly SeatNameInput[] | null): Map<string, SeatedStandIn> {
  const out = new Map<string, SeatedStandIn>();
  if (view == null) return out;
  const named = (key: string, display: string | null): string => seatKeyName(key, display !== null ? [{ key: standInBase(key) ?? key, display_name: display }] : roster);
  const put = (key: string | null, display: string | null, label: string | null, role: string | null): void => {
    if (key === null || standInBase(key) === null) return;
    const had = out.get(key);
    out.set(key, {
      key,
      name: had !== undefined && display === null ? had.name : named(key, display),
      label: label ?? had?.label ?? null,
      role: role ?? had?.role ?? null,
    });
  };
  const assurance = rec(rec(view.session)?.['assurance']);
  for (const s of list(assurance?.['standIns'])) {
    const r = rec(s);
    if (r !== null) put(text(r['key']), text(r['display']), null, text(r['role']));
  }
  for (const u of view.units) {
    const unit = rec(u);
    for (const role of list(rec(unit?.['assurance'])?.['roles'])) {
      const r = rec(role);
      const si = rec(r?.['standIn']);
      if (si !== null) put(text(si['cli']) ?? text(r?.['seat']), null, text(si['label']), text(r?.['role']));
    }
    put(text(unit?.['assigned_cli']), null, null, null);
  }
  const sessionLabel = text(assurance?.['standInLabel']);
  const reviewers = [...out.values()].filter((s) => s.role === 'evaluator');
  if (sessionLabel !== null && reviewers.length === 1 && reviewers[0]!.label === null) out.set(reviewers[0]!.key, { ...reviewers[0]!, label: sessionLabel });
  return out;
}

const STOOD_FOR: Record<string, string> = { evaluator: 'the review', judge: 'the judge', rule_judge: 'the rules check', qe_reviewer: 'the QE check' };

/** A stand-in in one line: the engine's own sentence, else its name and the role it stood in for. */
export function standInLine(s: SeatedStandIn): string {
  if (s.label !== null) return s.label;
  const role = s.role !== null ? (STOOD_FOR[s.role] ?? s.role.replace(/_/g, ' ')) : null;
  return role !== null ? `${s.name} stood in for ${role}` : s.name;
}
