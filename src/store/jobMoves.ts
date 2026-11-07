import { create } from 'zustand';
import { api } from '../api/client.js';
import type { ArtifactProposal } from '../api/types.js';
import { catalogV2Now } from './catalogV2.js';
import { postJob } from './inlineStart.js';

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

const KEY = 'wk.jobMoves.v1';
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

/** The moves kept in storage, as they are (validated, own keys only, never a prototype key). */
function parseMoves(raw: string | null): Record<string, JobMove> {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Array<[string, JobMove]> = [];
    for (const [pid, v] of Object.entries(parsed as Record<string, unknown>)) {
      const m = UNSAFE.has(pid) ? null : asMove(v);
      if (m !== null) out.push([pid, m]);
    }
    return Object.fromEntries(out);
  } catch { return {}; }
}

/** The moves a previous load of this tab (or another tab) kept. A set-aside still out when the page went is not known
 *  to have landed: it reads as not confirmed, and the passage's own phase (asking, or not started) says which. */
export function readMoves(raw: string | null): Record<string, JobMove> {
  const out = parseMoves(raw);
  for (const [pid, m] of Object.entries(out)) {
    if (m.retired === 'pending') out[pid] = { ...m, retired: 'failed', error: 'This one may not have been set aside.' };
  }
  return out;
}

/** The newest {@link KEEP}. */
function bound(moves: Record<string, JobMove>): Record<string, JobMove> {
  const all = Object.entries(moves);
  return all.length <= KEEP ? moves : Object.fromEntries(all.sort((x, y) => y[1].at - x[1].at).slice(0, KEEP));
}

const storage = (): Storage | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

function load(): Record<string, JobMove> {
  try { return readMoves(storage()?.getItem(KEY) ?? null); } catch { return {}; }
}

/** Write one move into what storage holds NOW (another tab's moves are kept, never overwritten by this tab's copy). */
function save(pid: string, m: JobMove): void {
  const st = storage();
  if (st === null) return;
  try { st.setItem(KEY, JSON.stringify(bound({ ...parseMoves(st.getItem(KEY)), [pid]: m }))); } catch { /* storage blocked: this tab only */ }
}

/** `moves`: by the moved proposal's id. `moving`: a move out now, by that id (a remount or another control's press
 *  never starts a second one). */
export const useJobMoves = create<{ moves: Record<string, JobMove>; moving: Record<string, true> }>(() => ({ moves: load(), moving: {} }));

/** The move kept for a proposal (own entries only). */
export function moveOf(moves: Readonly<Record<string, JobMove>>, pid: string): JobMove | null {
  return Object.prototype.hasOwnProperty.call(moves, pid) ? moves[pid]! : null;
}

export function putMove(pid: string, m: Omit<JobMove, 'at'> & { at?: number }): void {
  if (UNSAFE.has(pid)) return;
  const entry: JobMove = { ...m, at: m.at ?? moveOf(useJobMoves.getState().moves, pid)?.at ?? Date.now() };
  useJobMoves.setState((s) => ({ moves: bound({ ...s.moves, [pid]: entry }) }));
  save(pid, entry);
}

// Another tab's moves reach this one: a move this tab has not seen, or one the other tab saw set aside.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    const theirs = parseMoves(e.newValue);
    useJobMoves.setState((s) => {
      const next = { ...s.moves };
      let changed = false;
      for (const [pid, m] of Object.entries(theirs)) {
        const mine = moveOf(next, pid);
        if (mine === null || (m.retired === 'done' && mine.retired !== 'done' && m.chatId === mine.chatId)) { next[pid] = m; changed = true; }
      }
      return changed ? { moves: bound(next) } : s;
    });
  });
}

/** Tests: forget every move (this tab and the kept copy). */
export function resetJobMoves(): void {
  useJobMoves.setState({ moves: {}, moving: {} });
  try { storage()?.removeItem(KEY); } catch { /* nothing kept */ }
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
}): Promise<boolean> {
  const shape = m.proposal.shape;
  const pid = m.proposal.pid;
  const st = useJobMoves.getState();
  if (shape === undefined || st.moving[pid] === true || moveOf(st.moves, pid) !== null) return false;
  useJobMoves.setState((s) => ({ moving: { ...s.moving, [pid]: true } }));
  try {
    const out = await postJob({
      card: await wireCardOf(shape), option: shape.option, depth: shape.depth, words: jobWords(m.proposal), source: 'pick',
      chatId: null, projectId: m.projectId, repoRef: m.repoRef, pickKey: m.pickKey,
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
