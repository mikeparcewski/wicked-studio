import { create } from 'zustand';
import { api } from '../api/client.js';
import type { ArtifactProposal } from '../api/types.js';
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
/** How many moves are kept across reloads (the newest). */
const KEEP = 100;

function isMove(v: unknown): v is JobMove {
  if (v === null || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return typeof m['chatId'] === 'string' && typeof m['where'] === 'string' && typeof m['at'] === 'number'
    && (m['retired'] === 'pending' || m['retired'] === 'done' || m['retired'] === 'failed');
}

/** The moves a previous load of this tab (or another tab) kept. A set-aside still out when the page went is not known
 *  to have landed: it reads as not confirmed, and the passage's own phase (asking, or not started) says which. */
export function readMoves(raw: string | null): Record<string, JobMove> {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return {};
    const out: Record<string, JobMove> = {};
    for (const [pid, m] of Object.entries(parsed as Record<string, unknown>)) {
      if (!isMove(m)) continue;
      out[pid] = m.retired === 'pending' ? { ...m, retired: 'failed', error: 'This one may not have been set aside.' } : { ...m, error: m.error ?? null };
    }
    return out;
  } catch { return {}; }
}

function load(): Record<string, JobMove> {
  try { return readMoves(globalThis.localStorage?.getItem(KEY) ?? null); } catch { return {}; }
}

function save(moves: Record<string, JobMove>): void {
  const kept = Object.entries(moves).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP);
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(Object.fromEntries(kept))); } catch { /* storage blocked: this tab only */ }
}

export const useJobMoves = create<{ moves: Record<string, JobMove> }>(() => ({ moves: load() }));

export function putMove(pid: string, m: Omit<JobMove, 'at'> & { at?: number }): void {
  useJobMoves.setState((s) => ({ moves: { ...s.moves, [pid]: { ...m, at: m.at ?? s.moves[pid]?.at ?? Date.now() } } }));
  save(useJobMoves.getState().moves);
}

/** Tests: forget every move (this tab and the kept copy). */
export function resetJobMoves(): void {
  useJobMoves.setState({ moves: {} });
  try { globalThis.localStorage?.removeItem(KEY); } catch { /* nothing kept */ }
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
  if (shape === undefined) return false;
  const out = await postJob({
    card: shape.card, option: shape.option, depth: shape.depth, words: jobWords(m.proposal), source: 'pick',
    chatId: null, projectId: m.projectId, repoRef: m.repoRef, pickKey: m.pickKey,
  });
  if (out === null) return false;
  retireMoved(m.fromChatId, m.proposal.pid, { chatId: out.chatId, where: m.where });
  return true;
}

/** The move a job's Not now was for: the old chat says where the job went, not only that it was set aside. */
export function movedFrom(moves: Readonly<Record<string, JobMove>>, l: { decisions: ReadonlyArray<{ pid: string; decision: 'go' | 'not_now' }> }): JobMove | null {
  for (const d of l.decisions) if (d.decision === 'not_now' && moves[d.pid] !== undefined) return moves[d.pid]!;
  return null;
}
