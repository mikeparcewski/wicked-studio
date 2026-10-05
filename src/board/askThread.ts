import type { TeamRow } from '../api/teamPlan.js';
import { blockOf } from './chainModel.js';

/**
 * THE ASK THREAD'S FOLD (DES-ASK-TEAM-CHAT-001 §4.8, slice ASK-S1). Pure.
 *
 * An ask is a team path (DES-TEAMING-002 applied to the Ask entry point): the PA answers in an
 * `understand` step `answer-N`, a reviewer member watches, helpers answer `HELP:` lines, and every
 * one of those is a `wicked.team.*` row on the bus. The session thread folds those rows into QUIET
 * LINES around the PA's reply — who answers and why, who is reviewing, what the reviewer found,
 * what help was asked and whether it came, a re-pick, a timeout, the end. Nothing on the agent side
 * is a bubble unless it is the PA's reply (rule 1); every line is expandable to its row (rule 2);
 * the run's chain line stays hidden while the plan has no creator step (rule 3 — the thread IS the
 * chain), which `askPathOf(rows).creatorAccepted` decides.
 *
 * The rows are read by `event_type` + named fields over the read-side `TeamRow` (payloads as
 * `Record<string, unknown>`), exactly as `board/chainModel.ts` does — a field the engine did not
 * send reads as absent, never as a guess.
 */

export type AskLineKind =
  | 'who' | 'reviewer' | 'finding' | 'help' | 'timeout' | 'repick' | 'restart' | 'refused' | 'proposal' | 'ended' | 'transport';

export interface AskLine {
  /** Stable per row (`a:<event_id>`); a finding or help line keeps the id of the row that opened it. */
  key: string;
  /** The row's `payload.at` (Unix millis) — the thread interleaves lines with the turns by it. */
  at: number;
  kind: AskLineKind;
  /** The line as shown, in plain words. */
  text: string;
  /** What expands under it — the look-underneath (rule 2). */
  detail: string[];
  tone: 'quiet' | 'problem' | 'end';
  /** The answer unit the line belongs to (`payload.ord`), when the row names one. */
  ord: number | null;
  /** `signin`: the line offers the Sign in panel (an absent reviewer, a one-seat refusal); `retry`: the
   *  team read failed and the line offers to read again. */
  action?: 'signin' | 'retry';
  /** The line sits UNDER the reply of its answer step (§4.8: a finding on the answer, a help exchange,
   *  the reviewer running out of time) — on the wire those rows land BEFORE the relay's `chatReply`
   *  (the final pass precedes the fold), so time order alone would put them above the bubble. */
  under?: boolean;
}

export interface AskShapeStep {
  id: string;
  catalog: string;
  /** answer · research · check · build · deliver · … — the operator's word for the step. */
  label: string;
  addedBy: string | null;
}

export interface AskPath {
  /** The current PA: `path.started.cli`, moved by every `path.repicked.to`. */
  pa: string | null;
  selection: 'chosen' | 'random' | null;
  roster: string[];
  /** The reviewer member, first attempt only: attached, or failed (seat `null` = no distinct seat). */
  reviewer: { seat: string | null; status: 'attached' | 'failed'; error: string | null } | null;
  /** Seats that answered a help request. */
  helpers: string[];
  /** The latest `path.scored` with the band the matching `plan.accepted` gave it. */
  score: { score: number; band: string | null; reasons: string[] } | null;
  /** The accepted plan's steps (else the proposed ones), labelled for the operator. */
  shape: AskShapeStep[];
  /** An accepted plan carries a creator step: the chain line shows and the run block returns. */
  creatorAccepted: boolean;
  ended: string | null;
}

type Bag = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const type = (r: TeamRow): string => r.event_type.replace(/^wicked\.team\./, '');
const at = (r: TeamRow): number => num(r.payload['at']) ?? r.emitted_at ?? 0;
const isAnswerStep = (id: unknown): boolean => typeof id === 'string' && /^answer-\d+$/.test(id);

/** The operator's word for a plan step: an `understand` step with its gate raised is an ANSWER;
 *  research, check (review / test), build, deliver otherwise (T2 §8.3: the labels are studio's). */
export function askShapeLabel(step: { catalog: string; id?: string; gate?: unknown; owner?: unknown }): string {
  if (step.catalog === 'understand') {
    const gated = step.gate !== null && typeof step.gate === 'object' && 'human_confirm' in (step.gate as Bag);
    return gated || isAnswerStep(step.id) ? 'answer' : 'research';
  }
  const block = blockOf(step.catalog, typeof step.owner === 'string' ? step.owner : null);
  if (block === 'review' || block === 'test' || block === 'walkthrough') return 'check';
  if (block === 'build' || block === 'write') return 'build';
  if (block === 'plan') return 'plan';
  if (block === 'deliver') return 'deliver';
  return step.catalog.replace(/[-_]+/g, ' ');
}

/** A plan step is CREATOR work when it executes code: the build block (T2 §8.1's creator seat). */
function isCreatorStep(step: Bag): boolean {
  const catalog = str(step['catalog']);
  if (catalog === null) return false;
  const block = blockOf(catalog, str(step['owner']));
  return block === 'build' || block === 'write';
}

function shapeOf(steps: unknown): AskShapeStep[] {
  if (!Array.isArray(steps)) return [];
  const out: AskShapeStep[] = [];
  for (const s of steps) {
    if (typeof s !== 'object' || s === null) continue;
    const b = s as Bag;
    const catalog = str(b['catalog']);
    const id = str(b['id']) ?? catalog;
    if (catalog === null || id === null) continue;
    out.push({ id, catalog, label: askShapeLabel({ catalog, id, gate: b['gate'], owner: b['owner'] }), addedBy: str(b['added_by']) });
  }
  return out;
}

/** The path as the rows tell it: PA, pick, roster, reviewer, helpers, score, shape, end. */
export function askPathOf(rows: readonly TeamRow[]): AskPath {
  const p: AskPath = { pa: null, selection: null, roster: [], reviewer: null, helpers: [], score: null, shape: [], creatorAccepted: false, ended: null };
  let proposedShape: AskShapeStep[] = [];
  let scored: { score: number; reasons: string[] } | null = null;
  let band: string | null = null;
  for (const r of rows) {
    const b = r.payload;
    switch (type(r)) {
      case 'path.started':
        p.pa = str(b['cli']);
        p.selection = b['selection'] === 'chosen' ? 'chosen' : b['selection'] === 'random' ? 'random' : null;
        p.roster = list(b['roster']);
        break;
      case 'path.repicked':
        p.pa = str(b['to']) ?? p.pa;
        break;
      case 'plan.proposed':
        proposedShape = shapeOf(b['steps']);
        break;
      case 'path.scored': {
        const score = num(b['score']);
        if (score !== null) scored = { score, reasons: list(b['reasons']) };
        break;
      }
      case 'plan.accepted': {
        band = str(b['band']);
        const steps = Array.isArray(b['steps']) ? (b['steps'] as unknown[]) : [];
        p.shape = shapeOf(steps);
        p.creatorAccepted = steps.some((s) => typeof s === 'object' && s !== null && isCreatorStep(s as Bag));
        break;
      }
      case 'member.joined':
        if (b['role'] === 'monitor' && p.reviewer === null) {
          p.reviewer = { seat: str(b['seat']), status: b['status'] === 'attached' ? 'attached' : 'failed', error: str(b['error']) };
        }
        break;
      case 'help.answered': {
        const by = str(b['by']);
        if ((b['outcome'] ?? 'answered') === 'answered' && by !== null && by !== 'engine' && !p.helpers.includes(by)) p.helpers.push(by);
        break;
      }
      case 'path.ended':
        p.ended = str(b['status']);
        break;
      default:
        break;
    }
  }
  if (scored !== null) p.score = { ...scored, band };
  if (p.shape.length === 0) p.shape = proposedShape;
  return p;
}

const ROSTER_JOIN = (xs: readonly string[]): string => xs.join(', ');
const bandWords = (band: string | null): string | null => (band === null ? null : `band ${band.replace('-', '–')}`);

/** `plan.refused.reason` in the operator's words (§4.7 one seat; F11 repo-less). */
function refusedWords(reason: string, pa: string | null): { text: string; action?: 'signin' } {
  if (/NoEligibleSeat|no seat distinct|no eligible seat/i.test(reason)) {
    return { text: `Can’t build from here: only ${pa ?? 'one helper'} is signed in; sign in another helper so review can run.`, action: 'signin' };
  }
  if (/no repo bound|repo-less|no repo_ref/i.test(reason)) {
    return { text: 'This conversation isn’t attached to a repo — open one from a project to build.' };
  }
  return { text: `The plan was refused: ${reason}` };
}

/** The quiet lines of an ask, in row order (§4.8 table). */
export function askLines(rows: readonly TeamRow[]): AskLine[] {
  const path = askPathOf(rows);
  const out: AskLine[] = [];
  const byFinding = new Map<string, AskLine>();
  const byHelp = new Map<string, { line: AskLine; question: string }>();
  const claimedAttempts = new Map<number, Set<number>>(); // ord → attempts seen claimed
  const repickedAttempts = new Set<string>(); // `${ord}:${attempt}` redispatched by a re-pick
  let who: AskLine | null = null;
  let reviewerDrawn = false;
  // The PA AT EACH ROW (codex on ASK-S1 #10): a re-pick moves it, and a line's words name the PA of its
  // own moment — never the final one rewritten into history.
  let paNow: string | null = null;
  const when = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';
  // The pick / score / shape detail reads the whole path: the who-line is finished after the pass.
  for (const r of rows) {
    const b = r.payload;
    const ord = num(b['ord']);
    const by = str(b['by']);
    const key = `a:${r.event_id}`;
    const t = at(r);
    switch (type(r)) {
      case 'path.started': {
        const cli = str(b['cli']) ?? 'a helper';
        paNow = str(b['cli']);
        who = { key, at: t, kind: 'who', text: `${cli} answers · ${b['selection'] === 'chosen' ? 'your pick' : 'picked at random'}`, detail: [], tone: 'quiet', ord: null };
        out.push(who);
        break;
      }
      case 'member.joined': {
        if (b['role'] !== 'monitor' || reviewerDrawn) break;
        reviewerDrawn = true;
        const seat = str(b['seat']);
        if (b['status'] === 'attached' && seat !== null) {
          out.push({ key, at: t, kind: 'reviewer', text: `${seat} is reviewing`, detail: [str(b['reason']) ?? ''].filter(Boolean), tone: 'quiet', ord });
        } else if (seat === null) {
          out.push({ key, at: t, kind: 'reviewer', text: `No reviewer — only ${paNow ?? path.pa ?? 'one helper'} is signed in.`, detail: [str(b['error']) ?? ''].filter(Boolean), tone: 'quiet', ord, action: 'signin' });
        } else {
          out.push({ key, at: t, kind: 'reviewer', text: `No reviewer — ${seat} can't join: ${str(b['error']) ?? 'it could not attach'}`, detail: [], tone: 'quiet', ord });
        }
        break;
      }
      case 'finding.raised': {
        if (b['target'] !== 'output') break; // tree findings are the chain's (creator steps)
        const id = str(b['finding_id']) ?? key;
        const line: AskLine = {
          key, at: t, kind: 'finding', text: `reviewer · 1 finding: ${str(b['claim']) ?? 'a finding'}`,
          detail: [`Evidence: ${str(b['evidence']) ?? '—'}`, ...(str(b['suggestion']) !== null ? [`Suggestion: ${str(b['suggestion'])}`] : [])],
          tone: 'quiet', ord, under: true,
        };
        byFinding.set(id, line);
        out.push(line);
        break;
      }
      case 'advice.answered': {
        const line = byFinding.get(str(b['finding_id']) ?? '');
        if (line === undefined) break;
        const reason = str(b['reason']);
        line.text += ` · ${by ?? path.pa ?? 'the helper'}: ${str(b['disposition']) ?? 'answered'}${reason !== null ? ` — ${reason}` : ''}`;
        break;
      }
      case 'finding.settled': {
        const line = byFinding.get(str(b['finding_id']) ?? '');
        if (line === undefined) break;
        if (b['status'] === 'held') line.text += ' · reviewer holds';
        else if (b['status'] === 'withdrawn') line.text += ' · withdrawn';
        break;
      }
      case 'help.requested': {
        const id = str(b['help_id']) ?? key;
        const question = str(b['question']) ?? 'help';
        const line: AskLine = { key, at: t, kind: 'help', text: `asked for help: ${question}`, detail: [], tone: 'quiet', ord, under: true };
        byHelp.set(id, { line, question });
        out.push(line);
        break;
      }
      case 'help.answered': {
        const hit = byHelp.get(str(b['help_id']) ?? '');
        if (hit === undefined) break;
        const outcome = str(b['outcome']) ?? 'answered';
        const seat = by !== null && by !== 'engine' ? by : path.reviewer?.seat ?? null;
        const q = hit.question;
        if (outcome === 'answered') {
          hit.line.text = `asked ${seat ?? 'a helper'}: ${q} · answered`;
          hit.line.detail = [str(b['answer']) ?? ''].filter(Boolean);
        } else if (outcome === 'no_member') {
          hit.line.text = `asked for help: ${q} · no other helper is signed in`;
        } else {
          hit.line.text = `asked ${seat ?? 'a helper'}: ${q} · ${seat ?? 'the helper'} did not answer (${outcome === 'timed_out' ? 'timed out' : outcome})`;
          hit.line.detail = [str(b['error']) ?? ''].filter(Boolean);
          hit.line.tone = 'problem';
        }
        break;
      }
      case 'step.claimed': {
        if (!isAnswerStep(b['step_id']) || ord === null) break;
        const attempt = num(b['attempt']) ?? 0;
        const seen = claimedAttempts.get(ord) ?? new Set<number>();
        seen.add(attempt);
        claimedAttempts.set(ord, seen);
        if (attempt > 0 && !repickedAttempts.has(`${ord}:${attempt}`)) {
          out.push({ key, at: t, kind: 'restart', text: `${by ?? paNow ?? 'the helper'} started over after a restart`, detail: [`${str(b['step_id']) ?? 'the answer step'} · attempt ${attempt} · at ${when(t)}`], tone: 'quiet', ord });
        }
        break;
      }
      case 'step.completed': {
        if (!isAnswerStep(b['step_id'])) break;
        const status = str(b['status']);
        const fact = `${str(b['step_id']) ?? 'the answer step'} · attempt ${num(b['attempt']) ?? 0} · ${status ?? 'unknown'} at ${when(t)}`;
        if (status === 'timed_out') {
          out.push({ key, at: t, kind: 'timeout', text: `${by ?? paNow ?? 'the helper'} didn’t answer in 10 min`, detail: [fact], tone: 'problem', ord });
        } else if (status !== null && status !== 'ok') {
          out.push({ key, at: t, kind: 'timeout', text: `${by ?? paNow ?? 'the helper'} couldn’t answer (${status.replace(/_/g, ' ')})`, detail: [fact], tone: 'problem', ord });
        }
        break;
      }
      case 'path.repicked': {
        const from = str(b['from']) ?? 'the helper';
        const to = str(b['to']) ?? 'another helper';
        const attempt = num(b['attempt']);
        if (ord !== null && attempt !== null) repickedAttempts.add(`${ord}:${attempt + 1}`);
        paNow = str(b['to']) ?? paNow;
        out.push({ key, at: t, kind: 'repick', text: `${to} takes over — ${from} stopped answering`, detail: [`${str(b['reason']) ?? 'seat failure'} · re-pick ${num(b['pick_seq']) ?? '?'} · at ${when(t)}`], tone: 'problem', ord });
        break;
      }
      case 'ledger.folded': {
        if (b['final_pass'] === 'timed_out') {
          out.push({ key, at: t, kind: 'reviewer', text: 'reviewer did not answer in time', detail: [`final pass timed out · at ${when(t)}`], tone: 'quiet', ord, under: true });
        }
        break;
      }
      case 'plan.proposed': {
        // A PA change that adds creator work: S2 draws the proposal card; the line names it.
        if (b['kind'] !== 'change') break;
        const steps = shapeOf(b['steps']);
        if (!steps.some((s) => s.label === 'build')) break;
        out.push({ key, at: t, kind: 'proposal', text: `${by ?? path.pa ?? 'the helper'} proposes to build: ${steps.map((s) => s.label).join(' → ')}`, detail: list(b['touch']).map((x) => `touches ${x}`), tone: 'quiet', ord });
        break;
      }
      case 'plan.refused': {
        const words = refusedWords(str(b['reason']) ?? 'refused', paNow ?? path.pa);
        out.push({ key, at: t, kind: 'refused', text: words.text, detail: [str(b['reason']) ?? ''].filter(Boolean), tone: 'problem', ord, ...(words.action !== undefined ? { action: words.action } : {}) });
        break;
      }
      case 'path.ended': {
        const status = str(b['status']);
        out.push({ key, at: t, kind: 'ended', text: status === 'completed' ? 'Conversation finished' : status === 'cancelled' || status === null ? 'Conversation ended' : `Conversation stopped (${status})`, detail: [`${status ?? 'ended'} · at ${when(t)}`], tone: 'end', ord: null });
        break;
      }
      default:
        break;
    }
  }
  if (who !== null) {
    // The pick is the path.started row's fact — the FIRST PA, whatever re-picks followed (#10).
    const first = str(rows.find((r) => type(r) === 'path.started')?.payload['cli']) ?? 'a helper';
    const pick = path.selection === 'chosen'
      ? `You picked ${first}${path.roster.length > 0 ? ` from ${ROSTER_JOIN(path.roster)}` : ''}.`
      : `Picked ${first} at random${path.roster.length > 0 ? ` from ${ROSTER_JOIN(path.roster)}` : ''}.`;
    who.detail = [
      pick,
      ...(path.score !== null ? [[`Score ${path.score.score}`, bandWords(path.score.band), ...path.score.reasons].filter((x): x is string => x !== null).join(' · ') + '.'] : []),
      ...(path.shape.length > 0 ? [`Shape: ${path.shape.map((s) => s.label).join(' → ')}.`] : []),
    ];
  }
  return out;
}

/** The ask run's answer steps that are claimed and not yet completed: the "thinking" state per ord. */
export function askThinking(rows: readonly TeamRow[]): Array<{ ord: number; by: string; at: number }> {
  const open = new Map<number, { ord: number; by: string; at: number }>();
  for (const r of rows) {
    const b = r.payload;
    if (!isAnswerStep(b['step_id'])) continue;
    const ord = num(b['ord']);
    if (ord === null) continue;
    if (type(r) === 'step.claimed') open.set(ord, { ord, by: str(b['by']) ?? 'the helper', at: at(r) });
    else if (type(r) === 'step.completed') open.delete(ord);
  }
  return [...open.values()];
}

/** When each answer step completed (`step.completed.at` per ord): the thread places a line marked
 *  `under` after the first reply bubble at or after that moment. */
export function askCompletedAt(rows: readonly TeamRow[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) {
    const b = r.payload;
    if (type(r) !== 'step.completed' || !isAnswerStep(b['step_id'])) continue;
    const ord = num(b['ord']);
    if (ord !== null) out.set(ord, at(r));
  }
  return out;
}

/** The ask's answer steps' unit ords, in order (`step.claimed{step_id: answer-N}`), so the k-th PA reply
 *  of the transcript is the k-th answer step's (#4). */
export function askAnswerOrds(rows: readonly TeamRow[]): number[] {
  const ords: number[] = [];
  for (const r of rows) {
    const b = r.payload;
    if (type(r) !== 'step.claimed' || !isAnswerStep(b['step_id'])) continue;
    const ord = num(b['ord']);
    if (ord !== null && !ords.includes(ord)) ords.push(ord);
  }
  return ords.sort((a, b) => a - b);
}

/** Gate kinds that are the ask's TURN gate (the engine's def / terminal HumanConfirm on an answer
 *  step): the composer is the answer, nothing is drawn as a gate (§4.8; codex #3). */
const TURN_GATE_KINDS: ReadonlySet<string> = new Set(['def', 'terminal']);
/** The engine's own words for a def / terminal gate (the ones `stepQuestion` reads too) — how a gate
 *  reconciled on a late join (`GET /runs/:id/gate` carries no kind) is told apart from a hand-over,
 *  an escalation or a plan approval (codex on ASK-S1 #3). */
const TURN_GATE_PROMPT = /^\s*Approve (?:unit \d+ before it runs|the output of unit \d+)\b/i;

/** What the gate filter knows about ask runs: which runs are paths, and which have accepted a creator
 *  step — after that every gate is real work's and is drawn (codex on ASK-S1 #1). */
export interface AskGateKnowledge {
  runs: ReadonlySet<string>;
  creatorAccepted: Readonly<Record<string, boolean>>;
}

export function isAskTurnGate(know: AskGateKnowledge, runId: string, gateKind: string | undefined, prompt?: string): boolean {
  if (!know.runs.has(runId) || know.creatorAccepted[runId] === true) return false;
  if (gateKind !== undefined) return TURN_GATE_KINDS.has(gateKind);
  return prompt !== undefined && TURN_GATE_PROMPT.test(prompt);
}
