/**
 * (J6 S1) The domain model view's words and orderings, from crew's `model` (api-types 0.230.0): the header, the rule
 * groups by area (business first, housekeeping last), the follow-ups in the order a person works them, the ruling a
 * follow-up's action sends, and a ruling refusal in plain words. Pure: the component only renders these.
 */
import { ApiError } from '../api/errors.js';
import type {
  DomainFollowup,
  DomainModel,
  DomainRuleGroup,
  DomainRulingBody,
  DomainScopeCard,
  DomainStatement,
} from '../api/domainModel-wire.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The page's `model`, or null when the page has none (a 1.1.0 graph, an older daemon) or it is not one. */
export function domainModelOf(page: unknown): DomainModel | null {
  const m = isObj(page) ? page['model'] : undefined;
  if (!isObj(m) || !isObj(m['accounting'])) return null;
  const arrays = ['statements', 'ruleGroups', 'followups', 'targets'] as const;
  if (!arrays.every((k) => Array.isArray(m[k]))) return null;
  return m as unknown as DomainModel;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A follow-up a person has not ruled on yet. */
export const followupOpen = (f: DomainFollowup): boolean => f.ruling === null;

/** A statement the model rests on: checked by the second seat, or confirmed by a person. */
export const statementChecked = (s: DomainStatement): boolean => s.status === 'Checked' || s.status === 'confirmed';

/** "1 rule · 1 checked statement · 4 follow-ups · 2 of 4 targets accounted". */
export function modelHeadline(m: DomainModel): string {
  const rules = m.ruleGroups.filter((g) => g.rule !== null).length;
  const checked = m.statements.filter(statementChecked).length;
  const follow = m.followups.filter(followupOpen).length;
  const { accounted, targets } = m.accounting;
  return [
    plural(rules, 'rule'),
    plural(checked, 'checked statement'),
    plural(follow, 'follow-up'),
    `${accounted.toLocaleString('en-US')} of ${plural(targets, 'target')} accounted`,
  ].join(' · ');
}

/** Groups by area (named order), business groups before any other kind, housekeeping last (an area can show in each part). */
export function groupsByArea(m: DomainModel): Array<{ area: string; groups: DomainRuleGroup[] }> {
  const rank = (g: DomainRuleGroup): number => (g.kind === 'business' ? 0 : g.kind === 'housekeeping' ? 2 : 1);
  const sorted = [...m.ruleGroups].sort((a, b) => rank(a) - rank(b) || a.area.localeCompare(b.area) || a.title.localeCompare(b.title));
  const out: Array<{ area: string; groups: DomainRuleGroup[]; rank: number }> = [];
  for (const g of sorted) {
    const area = g.area.trim() !== '' ? g.area : 'Other';
    // codex S1 r1: an area's housekeeping stays in the housekeeping part (last), never pulled up to its business groups.
    const last = out.find((x) => x.area === area && x.rank === rank(g));
    if (last !== undefined) last.groups.push(g);
    else out.push({ area, groups: [g], rank: rank(g) });
  }
  return out.map(({ area, groups }) => ({ area, groups }));
}

const KIND_ORDER = ['flagged', 'open', 'refused', 'scope'];

/** Follow-ups to work first: unruled before ruled, then flagged, open, refused, scope (DES-j6-build §7), then by n. */
export function followupsInOrder(m: DomainModel): DomainFollowup[] {
  const k = (f: DomainFollowup): number => {
    const i = KIND_ORDER.indexOf(f.kind);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...m.followups].sort((a, b) => Number(!followupOpen(a)) - Number(!followupOpen(b)) || k(a) - k(b) || a.n - b.n);
}

/** What a follow-up row offers: Confirm/Reject on a statement, Confirm on a target's lines, or nothing. */
export type FollowupAction = 'statement' | 'target' | 'none';

export function followupAction(m: DomainModel, f: DomainFollowup): FollowupAction {
  if (!followupOpen(f)) return 'none';
  if (f.statement !== null && rulingBodyFor(m, f, 'confirm') !== null) return 'statement';
  if (f.kind === 'refused' && f.statement === null && rulingBodyFor(m, f, 'confirm') !== null) return 'target';
  return 'none';
}

/** The words of a target Confirm (coord ruling b, 2026-11-25). */
export const TARGET_CONFIRM_WORDS = 'These lines make no business decision';

/**
 * The ruling a follow-up's action sends, with the statement's `key` and its target's `targetHash` as this model gives
 * them (crew refuses a stale one with 409). Null when the model does not hold what the ruling must name. A target
 * ruling is Confirm only; a Reject needs its note.
 */
export function rulingBodyFor(m: DomainModel, f: DomainFollowup, action: 'confirm' | 'reject', note = ''): DomainRulingBody | null {
  if (action === 'reject' && note.trim() === '') return null;
  if (f.statement !== null) {
    const st = m.statements.find((s) => s.id === f.statement);
    const targetId = st?.target ?? f.target;
    const target = targetId === null ? undefined : m.targets.find((t) => t.id === targetId);
    if (st === undefined || target === undefined) return null;
    return {
      statement: st.id,
      expect: st.key,
      expectTarget: target.targetHash,
      action,
      ...(action === 'reject' ? { note: note.trim() } : {}),
    };
  }
  if (action !== 'confirm' || f.target === null) return null;
  const target = m.targets.find((t) => t.id === f.target);
  return target === undefined ? null : { target: target.id, expectTarget: target.targetHash, action: 'confirm' };
}

/** A ruling crew refused, in words (crew's own sentence kept after them). */
export function rulingRefusalWords(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e);
  const code = isObj(e.body) && typeof e.body['code'] === 'string' ? e.body['code'] : null;
  const said = e.wire.trim();
  const tail = said !== '' ? ` (${said})` : '';
  switch (code) {
    case 'stale_code':
    case 'changed':
      return `The code or the model changed since this was read: look at it as it reads now.${tail}`;
    case 'not_open':
      return `This was already settled.${tail}`;
    case 'not_found':
      return `The model no longer holds this.${tail}`;
    case 'note_required':
      return 'Say what is wrong to reject it.';
    default:
      return e.status === 403 ? `Only a person can rule on the model.${tail}` : e.message;
  }
}

/** "Where": `file:20-29`, or `file:20` for one line. */
export function whereLine(f: DomainFollowup): string | null {
  if (f.where === null) return null;
  const [a, b] = f.where.lines;
  return `${f.where.file}:${a === b ? a : `${a}-${b}`}`;
}

/** The scope card's matched code for a phrase, said short: the first names and how many more. */
export function matchedLine(names: string[], max = 4): string {
  if (names.length === 0) return 'no code';
  const shown = names.slice(0, max).join(', ');
  return names.length > max ? `${shown} +${names.length - max} more` : shown;
}

/** Every phrase a card read: the matched ones, then those that matched nothing (each once). */
export function cardPhrases(card: DomainScopeCard): string[] {
  return [...new Set([...Object.keys(card.phrases), ...card.unmatchedPhrases])];
}

/**
 * The phrases after one edit: `current` (null: the words decide, so the card's own phrases) with `drop` taken out or
 * `add` put in. A typed phrase is trimmed, kept to 200 characters' worth of phrase (longer is refused), and not
 * doubled; at most 50 (crew's bounds).
 */
export function editPhrases(current: readonly string[] | null, card: DomainScopeCard | null, edit: { drop: string } | { add: string }): string[] | null {
  const base = current ?? (card === null ? null : cardPhrases(card));
  if (base === null) return null;
  if ('drop' in edit) return base.filter((p) => p !== edit.drop);
  const t = edit.add.trim();
  if (t === '' || t.length > 200 || base.includes(t) || base.length >= SCOPE_PHRASES_MAX) return [...base];
  return [...base, t];
}

/** The card's one-line size: "2 files · 4 targets". */
/** crew's bound on a scope's phrases. */
export const SCOPE_PHRASES_MAX = 50;

export function scopeSizeLine(card: DomainScopeCard): string {
  return `${plural(card.files.length, 'file')} · ${plural(card.targets, 'target')}`;
}

/** wicked-core's words for a garden too old to map a domain (wicked-core src/domain_extraction.rs OLD_GARDEN_REFUSAL). */
export const OLD_GARDEN_WORDS = 'this wicked-garden is too old to map a domain: upgrade it';

/**
 * studio#1473: crew's scope failure in words. Crew relays garden's last stderr line (`the scope failed: <line>`); a garden
 * older than the scope script answers with its launcher's JSON and the absolute plugin root. That garden is said the way
 * core's run step says it; any other answer keeps crew's words, garden's JSON read down to its `reason`, and no absolute
 * path, POSIX or Windows (the last segment stays).
 */
export function scopeErrorWords(error: string): string {
  const brace = error.indexOf('{');
  let words = error;
  if (brace >= 0) {
    try {
      const j: unknown = JSON.parse(error.slice(brace));
      const reason = typeof j === 'object' && j !== null ? (j as { reason?: unknown }).reason : undefined;
      if (typeof reason === 'string' && reason.trim() !== '') words = `${error.slice(0, brace)}${reason}`;
    } catch { /* not JSON: kept as said */ }
  }
  // Garden's launcher, missing the scope script (JSON-escaped or read down to its reason; POSIX or Windows separators).
  if (/scripts(?:\\+|\/)domain(?:\\+|\/)scope\.py: not found under the plugin root/.test(words)) return OLD_GARDEN_WORDS;
  return words
    .replace(/(^|[\s"'(=:])\/(?:[^\s"'/]+\/)*([^\s"'/,;)]+)/g, '$1…/$2')
    .replace(/(^|[\s"'(=:])[A-Za-z]:\\(?:[^\s"'\\]+\\)*([^\s"'\\,;)]+)/g, '$1…\\$2');
}

/** What holds a domain map's Start while its scope is not ready (the launch wizard and the chat job say the same). */
export function domainScopeHeld(status: 'off' | 'loading' | 'ready' | 'failed'): string | null {
  return status === 'loading' ? 'Reading the code for the scope…' : status === 'failed' ? 'There is no scope to start from yet: see the card.' : null;
}
