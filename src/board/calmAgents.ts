import { benchWord, type AgentRow, type Tone, agentTiles } from './agentsModel.js';

/**
 * The calm Agents page's words (the operator-approved pages mockup, 2026-10-26): one row per CLI
 * with its week and ONE status word — Ready / Out of quota, back at HH:MM / Not signed in → Sign
 * in. Pure, over the same rows the Agents model derives (so the row, the rail's dot and the modal
 * never disagree); pinned by unit test.
 */

export interface AgentStatus {
  word: string;
  tone: Tone;
  /** The row's one move beside the word: sign in, or look at what needs fixing. */
  move: 'signin' | null;
}

function clock(iso: string): string | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
}

/** The status word: the row's own readiness, in the page's fewer words. */
export function agentStatus(row: AgentRow): AgentStatus {
  if (row.sign.word === 'Signed out') return { word: 'Not signed in', tone: 'quiet', move: 'signin' };
  if (row.bench !== null) {
    const at = clock(row.bench.lifts_at);
    return { word: at === null ? benchWord(row.bench) : `${benchWord(row.bench)}, back at ${at}`, tone: 'gate', move: null };
  }
  return { word: row.ready.word, tone: row.ready.tone, move: null };
}

/** The row's second line: this week's steps and how many passed their check first time. */
export function agentWeekLine(row: AgentRow): string | null {
  const w = row.week;
  if (w === null) return null;
  if (w.units === 0) return 'No work this week';
  const steps = `${w.units} ${w.units === 1 ? 'step' : 'steps'} this week`;
  if (w.gated === 0) return steps;
  return `${steps} · ${Math.round((Math.min(w.firstPass, w.gated) / w.gated) * 100)}% passed first time`;
}

/** The page's one sentence: "3 of 5 are ready to work." */
export function agentsSentence(rows: readonly AgentRow[]): string {
  if (rows.length === 0) return 'No AI agents found on this computer yet.';
  const t = agentTiles(rows);
  if (rows.length === 1) return t.ready === 1 ? 'Your one agent is ready to work.' : 'Your one agent isn’t ready to work yet.';
  if (t.ready === rows.length) return `All ${rows.length} are ready to work.`;
  return `${t.ready} of ${rows.length} are ready to work.`;
}
