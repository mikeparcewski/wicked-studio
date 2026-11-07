import { create } from 'zustand';
import { api } from '../api/client.js';
import type { ArtifactProposal } from '../api/types.js';
import { catalogV2Now } from './catalogV2.js';
import { placeToken, postJob } from './inlineStart.js';

/**
 * A job moved to a new chat (F39: a project it lacked; F41: a repository its chat had none of), by the moved proposal's
 * id: where it went and whether the old proposal was set aside (Not now). Crew keeps a chat's project and scope its
 * own (a revision's `project` edit is refused, a `repoRef` outside the scope too), so the job is seeded afresh there.
 *
 * Kept outside the passage, because the move itself navigates away (codex/pi r5): coming back finds the moved job (and
 * a retry of only the Not now), never fresh chips that would seed it again. Kept in localStorage too (bounded), so the
 * old chat reads "This job moved to … · Open it" after a reload, not only "You chose Not now".
 */
export interface JobMove {
  chatId: string;
  /** Where it went, as the line says it: a project's name, or "a new chat on <repository>". */
  where: string;
  retired: 'pending' | 'done' | 'failed';
  error: string | null;
  at: number;
}

/** One storage key per moved proposal (`<prefix><pid>`): tabs that write at once never overwrite each other's moves. */
export const MOVE_KEY_PREFIX = 'wk.jobMove.v1:';
/** How many moves are kept (the newest), in this tab and across reloads. */
const KEEP = 100;
/** Keys that would reach an object's prototype: never a proposal id. */
const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

/** One kept move, every field checked and normalized (the store is shared by tabs and older studios: untrusted). */
function asMove(v: unknown): JobMove | null {
  if (v === null || typeof v !== 'object') return null;
  const m = v as Record<string, unknown>;
  const { chatId, where, at, retired, error } = m;
  if (typeof chatId !== 'string' || chatId === '' || typeof where !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (retired !== 'pending' && retired !== 'done' && retired !== 'failed') return null;
  return { chatId, where, at, retired, error: typeof error === 'string' ? error : null };
}

function parseMove(raw: string | null): JobMove | null {
  if (raw === null) return null;
  try { return asMove(JSON.parse(raw) as unknown); } catch { return null; }
}

/** The newest {@link KEEP}. */
function bound(moves: Record<string, JobMove>): Record<string, JobMove> {
  const all = Object.entries(moves);
  return all.length <= KEEP ? moves : Object.fromEntries(all.sort((x, y) => y[1].at - x[1].at).slice(0, KEEP));
}

const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

/** The kept moves' keys, by proposal id (never a prototype name). */
function keptKeys(st: Storage): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < st.length; i += 1) {
    const k = st.key(i);
    if (k === null || !k.startsWith(MOVE_KEY_PREFIX)) continue;
    const pid = k.slice(MOVE_KEY_PREFIX.length);
    if (pid !== '' && !UNSAFE.has(pid)) out.push([pid, k]);
  }
  return out;
}

/** The moves a previous load of this tab (or another tab) kept, the newest {@link KEEP}. A set-aside still out when the
 *  page went is not known to have landed: it reads as not confirmed, and the passage's own phase says which. */
export function loadMoves(st: Storage | null = storage()): Record<string, JobMove> {
  if (st === null) return {};
  try {
    const out: Array<[string, JobMove]> = [];
    for (const [pid, k] of keptKeys(st)) {
      const m = parseMove(st.getItem(k));
      if (m !== null) out.push([pid, m.retired === 'pending' ? { ...m, retired: 'failed', error: 'This one may not have been set aside.' } : m]);
    }
    return bound(Object.fromEntries(out));
  } catch { return {}; }
}

/** Write one move under its own key, then drop the oldest kept beyond {@link KEEP}. */
function save(pid: string, m: JobMove): void {
  const st = storage();
  if (st === null) return;
  try {
    st.setItem(MOVE_KEY_PREFIX + pid, JSON.stringify(m));
    const kept = keptKeys(st);
    if (kept.length <= KEEP) return;
    const aged = kept.map(([, k]) => [k, parseMove(st.getItem(k))?.at ?? 0] as const).sort((x, y) => y[1] - x[1]);
    for (const [k] of aged.slice(KEEP)) st.removeItem(k);
  } catch { /* storage blocked or full: this tab only */ }
}

/** `moves`: by the moved proposal's id. `moving`: a move out now, by that id (a remount or another control's press
 *  never starts a second one). */
export const useJobMoves = create<{ moves: Record<string, JobMove>; moving: Record<string, true> }>(() => ({ moves: loadMoves(), moving: {} }));

/** The move kept for a proposal (own entries only). */
export function moveOf(moves: Readonly<Record<string, JobMove>>, pid: string): JobMove | null {
  return Object.prototype.hasOwnProperty.call(moves, pid) ? moves[pid]! : null;
}

export function putMove(pid: string, m: Omit<JobMove, 'at'> & { at?: number }): void {
  if (UNSAFE.has(pid) || pid === '') return;
  const entry: JobMove = { ...m, at: m.at ?? moveOf(useJobMoves.getState().moves, pid)?.at ?? Date.now() };
  useJobMoves.setState((s) => ({ moves: bound({ ...s.moves, [pid]: entry }) }));
  save(pid, entry);
}

/** Another tab's word on a move: taken when this tab has none, or has the same move not yet set aside (its pending,
 *  failed or done reaches this tab; a move this tab saw set aside never goes back). */
export function adoptMove(pid: string, theirs: JobMove | null): void {
  if (theirs === null || UNSAFE.has(pid) || pid === '') return;
  useJobMoves.setState((s) => {
    const mine = moveOf(s.moves, pid);
    if (mine !== null && (mine.retired === 'done' || mine.chatId !== theirs.chatId)) return s;
    return { moves: bound({ ...s.moves, [pid]: theirs }) };
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || !e.key.startsWith(MOVE_KEY_PREFIX)) return;
    adoptMove(e.key.slice(MOVE_KEY_PREFIX.length), parseMove(e.newValue));
  });
}

/** Tests: forget every move (this tab and the kept copies). */
export function resetJobMoves(): void {
  useJobMoves.setState({ moves: {}, moving: {} });
  const st = storage();
  if (st === null) return;
  try {
    const all = Array.from({ length: st.length }, (_, i) => st.key(i)).filter((k): k is string => k !== null && k.startsWith(MOVE_KEY_PREFIX));
    for (const k of all) st.removeItem(k);
  } catch { /* nothing kept */ }
}

/** Set the old proposal aside (Not now) once its job has moved; its outcome is kept with the move. */
export function retireMoved(fromChatId: string, pid: string, to: { chatId: string; where: string }): void {
  putMove(pid, { ...to, retired: 'pending', error: null });
  api.decideChatProposal(fromChatId, pid, { decision: 'not_now' }).then(
    () => putMove(pid, { ...to, retired: 'done', error: null }),
    (e: unknown) => putMove(pid, { ...to, retired: 'failed', error: `This one was not set aside (${e instanceof Error ? e.message : String(e)}).` }),
  );
}

/** The job's words as the person gave them: the first words, then the corrections carried as details (crew rebuilds the
 *  brief from both). */
export function jobWords(p: Pick<ArtifactProposal, 'words' | 'details'>): string {
  return [p.words ?? '', ...(p.details ?? [])].map((w) => w.trim()).filter((w) => w !== '').join('. ');
}

/**
 * Move a job: seed the same job (card, option, depth, words with their corrections) in a new chat in `projectId` (when
 * set) on `repoRef` (when set), then set the old one aside. Recorded at once on the seed's success, before the caller
 * lets its press guard go, so no second press seeds again (pi/codex r5). Throws with the daemon's words when the seed
 * is refused; resolves false when the person no longer wants it (nothing moved).
 */
export async function moveJob(m: {
  fromChatId: string;
  proposal: ArtifactProposal;
  projectId: string | null;
  repoRef: string | null;
  where: string;
  pickKey: string;
  /** Where the person was at the press ({@link placeToken}); default: now. Moved elsewhere since: nothing is moved. */
  here?: string;
}): Promise<boolean> {
  const here = m.here ?? placeToken();
  const stillWanted = (): boolean => placeToken() === here;
  const shape = m.proposal.shape;
  const pid = m.proposal.pid;
  const st = useJobMoves.getState();
  if (shape === undefined || st.moving[pid] === true || moveOf(st.moves, pid) !== null) return false;
  useJobMoves.setState((s) => ({ moving: { ...s.moving, [pid]: true } }));
  try {
    const card = await wireCardOf(shape);
    // The catalog read is a wait of its own: a person who went elsewhere meanwhile is not moved over (codex r8).
    if (!stillWanted()) return false;
    const out = await postJob({
      card, option: shape.option, depth: shape.depth, words: jobWords(m.proposal), source: 'pick',
      chatId: null, projectId: m.projectId, repoRef: m.repoRef, pickKey: m.pickKey, stillWanted,
    });
    if (out === null) return false;
    retireMoved(m.fromChatId, pid, { chatId: out.chatId, where: m.where });
    return true;
  } finally {
    useJobMoves.setState((s) => {
      const moving = { ...s.moving };
      delete moving[pid];
      return { moving };
    });
  }
}

/** What a moved job's seed names as its card: the card id, or for a hidden card (reached only by its own command,
 *  crew refuses its id: routes.ts `seedCardRefusal`) the alias bound to its option. The catalog unread: the id. */
export async function wireCardOf(shape: { card: string; option: string | null }): Promise<string> {
  try {
    const load = await catalogV2Now(null);
    if (load.state !== 'ready') return shape.card;
    const card = load.view.cards.find((c) => c.id === shape.card);
    if (card === undefined || card.hidden !== true) return shape.card;
    const alias = card.aliases.find((x) => x.option === shape.option) ?? card.aliases.find((x) => x.option === null);
    return alias?.command ?? shape.card;
  } catch { return shape.card; }
}

/** The move a job's Not now was for: the old chat says where the job went, not only that it was set aside. */
export function movedFrom(moves: Readonly<Record<string, JobMove>>, l: { decisions: ReadonlyArray<{ pid: string; decision: 'go' | 'not_now' }> }): JobMove | null {
  for (const d of l.decisions) {
    const m = d.decision === 'not_now' ? moveOf(moves, d.pid) : null;
    if (m !== null) return m;
  }
  return null;
}
