import type { ArtifactProposal, CatalogGateId, ChatPlanOffer, ProposalQuestion, ProposalResult, ProposalRevisionEdits, ProposalSuggestion, ProposalToken, SessionView } from '../api/types.js';

/**
 * THE JOB STREAM (DES-CATALOG-002 rev 7 §2.8.3): one client-side projection that gives one state per job, read by
 * wicked's passage in the thread (E1a) and, later, the side panel's Job tab (E1b). It is a projection over studio's
 * existing folds, never a second fold of raw frames: the chat transcript's proposal records (folded here by lineage,
 * with crew's own rules), and the launched run's view, open gate, plan-gate read and undo queue, which their own stores
 * keep. Nothing here writes a label: every word drawn from a record is crew's.
 *
 * Two pure steps:
 *  1. {@link foldJobLineages}: the chat's `proposal*` and `plan_offer` records → one {@link JobLineage} per lineage
 *     (a root proposal and every proposal that revises it, across kinds; `revises`/`lineage`, Lane C).
 *  2. {@link jobView}: a lineage + its run's inputs → the state the passage draws (§2.7.2's rows), with its replies
 *     computed ONCE, so every place that draws the job enables and holds the same replies (§2.7.3 rule 9, §2.8.1).
 */

/** A job proposal as crew resolved it: a `job`, or a v2-catalog `create` (it carries the same conversational fields). */
export type JobProposal = ArtifactProposal;

export interface JobVersion {
  pid: string;
  turnId: string;
  /** When crew first recorded it (daemon millis). */
  at: number;
  proposal: JobProposal;
}

/** A one-line trace under the person's message that caused a change (rev 6 §2.7.1, kept by rev 7). */
export interface JobMark {
  /** The person's message (its turn) the mark sits under. */
  turnId: string;
  at: number;
  kind: 'changed' | 'unchanged';
  /** The version it led to (changed) or that stayed (unchanged), 1-based. */
  version: number;
  text: string;
}

export interface JobLineage {
  lineage: string;
  versions: JobVersion[];
  head: JobVersion;
  /** crew's fold state of the head. */
  state: 'open' | 'revising' | 'accepting' | 'decided' | 'superseded';
  revisingTurn: string | null;
  /** crew's word on the last hold that ended without a change, until a newer version replaces it. */
  note: string | null;
  decision: 'go' | 'not_now' | null;
  result: ProposalResult | null;
  /** What Go accepted (edits applied): drawn once accepting / started. */
  accepted: JobProposal | null;
  acceptingAt: number | null;
  decidedAt: number | null;
  /** The run Go launched (the accepting record's identity, then the decided result). */
  runId: string | null;
  /** The plan offers crew made at this job's held plan: the newest per run. */
  offers: ChatPlanOffer[];
  /** Every decision recorded on the lineage's versions, in order (a reshape's replacement keeps its predecessor's). */
  decisions: Array<{ pid: string; version: number; decision: 'go' | 'not_now'; at: number; runId: string | null; stub: boolean }>;
  marks: JobMark[];
  /** Where the passage sits in the thread: the newest record that changed it (§2.8.1). */
  at: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';

function isToken(t: unknown): t is ProposalToken {
  if (!isObj(t) || !str(t['id']) || !str(t['kind']) || !str(t['label'])) return false;
  const swap = t['swap'];
  if (swap === null) return true;
  return isObj(swap) && Array.isArray(swap['choices']) && swap['choices'].every((c) => isObj(c) && str(c['label']) && isObj(c['edit']));
}

/**
 * A proposal the passage can draw: a `job`, or a `create` carrying the v2 conversational fields. The sentence is what
 * Start runs, so a record without a well-formed one is skipped, never drawn half (crew's records; a malformed one
 * never crashes the thread).
 */
export function isJobProposal(p: unknown): p is JobProposal {
  if (!isObj(p) || !str(p['pid']) || !str(p['chatId']) || !str(p['seat'])) return false;
  if (p['kind'] !== 'job' && p['kind'] !== 'create') return false;
  const what = p['what'];
  if (!isObj(what) || !str(what['label']) || !str(what['title'])) return false;
  const gate = p['gate'];
  if (gate !== undefined && (!Array.isArray(gate) || !gate.every(str))) return false;
  const seats = p['seats'];
  if (seats !== undefined && (!isObj(seats) || !(seats['lead'] === null || str(seats['lead'])))) return false;
  const s = p['sentence'];
  if (!isObj(s) || !str(s['text']) || !Array.isArray(s['tokens']) || !s['tokens'].every(isToken)) return false;
  if (!Array.isArray(s['notes']) || !s['notes'].every(str) || !(s['ask'] === null || str(s['ask']))) return false;
  if (p['blocked'] !== null && !str(p['blocked'])) return false;
  if (p['lineage'] !== undefined && !str(p['lineage'])) return false;
  if (p['revises'] !== undefined && p['revises'] !== null && !str(p['revises'])) return false;
  const sk = p['sketch'];
  if (sk !== undefined && (!isObj(sk) || !Array.isArray(sk['steps']) || !sk['steps'].every((x) => isObj(x) && str(x['label']) && typeof x['asks'] === 'boolean'))) return false;
  const q = p['question'];
  if (q !== undefined && q !== null && (!isObj(q) || !str(q['text']) || !Array.isArray(q['choices']) || !q['choices'].every((c) => isObj(c) && str(c['label']) && isObj(c['edit'])))) return false;
  if (isObj(q) && q['input'] !== undefined) {
    const input = q['input'];
    if (!isObj(input) || !str(input['label']) || !str(input['edit']) || !(input['edit'] === 'skipQe.reason' || input['edit'].startsWith('inputs.'))) return false;
  }
  const sg = p['suggestions'];
  return sg === undefined || (Array.isArray(sg) && sg.every((x) => isObj(x) && str(x['label']) && isObj(x['edit'])));
}

function isOffer(o: unknown): o is ChatPlanOffer {
  return isObj(o) && str(o['id']) && (o['kind'] === 'send_back' || o['kind'] === 'reshape') && str(o['runId']) && str(o['pid'])
    && typeof o['ord'] === 'number' && typeof o['planRev'] === 'number' && str(o['text'])
    && Array.isArray(o['choices']) && o['choices'].every((c) => isObj(c) && str(c['label']) && (c['action'] === 'send_back' || c['action'] === 'reshape' || c['action'] === 'dismiss'));
}

function isResult(r: unknown): r is ProposalResult | null {
  return r === null || (isObj(r) && str(r['runId']) && typeof r['stub'] === 'boolean');
}

/** What changed between two versions, in crew's own token labels ("a move, .NET 8 on Linux"); `null` when nothing a
 *  token says changed (a note or a sketch only). */
export function changedWords(from: JobProposal, to: JobProposal): string | null {
  const before = new Map((from.sentence?.tokens ?? []).map((t) => [t.id, t.label]));
  const words = (to.sentence?.tokens ?? []).filter((t) => before.get(t.id) !== t.label).map((t) => t.label);
  return words.length === 0 ? null : words.join(', ');
}

/** The token ids whose label is new or changed since the previous version: only these move (§2.7.3 rule 1). */
export function changedTokenIds(from: JobProposal | null, to: JobProposal): Set<string> {
  if (from === null) return new Set();
  const before = new Map((from.sentence?.tokens ?? []).map((t) => [t.id, t.label]));
  return new Set((to.sentence?.tokens ?? []).filter((t) => before.get(t.id) !== t.label).map((t) => t.id));
}

interface Entry { lineage: string; state: JobLineage['state'] }

/**
 * The chat's job lineages, in the order crew first recorded them, folded as crew folds them (`chat-proposals.ts`):
 * the newest proposal is the chat's one open proposal and supersedes every other open one (of any kind); the same pid
 * again replaces it in place (a re-resolution, the same version); a revising hold is released by `proposal_released`
 * or replaced by the revision; an accepting or decided one stays so. Records of other kinds are ignored; a malformed
 * one is skipped.
 */
export function foldJobLineages(records: readonly unknown[]): JobLineage[] {
  const byPid = new Map<string, Entry>();
  const order: string[] = []; // every proposal pid of the chat, any kind, in first-record order
  const lineages = new Map<string, JobLineage>();
  const supersedeOthers = (pid: string): void => {
    for (const [other, e] of byPid) {
      if (other === pid || (e.state !== 'open' && e.state !== 'revising')) continue;
      e.state = 'superseded';
      const l = lineages.get(e.lineage);
      if (l !== undefined && l.head.pid === other) { l.state = 'superseded'; l.revisingTurn = null; }
    }
  };
  for (const r of records) {
    if (!isObj(r) || !str(r['kind'])) continue;
    const at = typeof r['at'] === 'number' ? r['at'] : 0;
    const turnId = str(r['turnId']) ? r['turnId'] : '';
    if (r['kind'] === 'proposal') {
      const p = r['proposal'];
      if (!isObj(p) || !str(p['pid'])) continue;
      const pid = p['pid'];
      const known = byPid.get(pid);
      if (!isJobProposal(p)) {
        // A malformed job record is skipped whole: it never supersedes the job that is drawn.
        if (p['kind'] === 'job' || p['sentence'] !== undefined) continue;
        // Another kind (a document card): it still takes the chat's one open slot (crew's rule).
        if (known === undefined) { order.push(pid); byPid.set(pid, { lineage: '', state: 'open' }); supersedeOthers(pid); }
        continue;
      }
      if (known !== undefined) {
        if (known.state === 'decided' || known.state === 'superseded' || known.state === 'accepting') continue;
        const l = lineages.get(known.lineage);
        if (l === undefined) continue;
        // A re-resolution of an older proposal while a newer one exists never takes the chat back.
        if (order.indexOf(pid) < order.length - 1) {
          known.state = 'superseded';
          if (l.head.pid === pid) l.state = 'superseded';
          continue;
        }
        const v = l.versions.find((x) => x.pid === pid);
        if (v !== undefined) v.proposal = p;
        l.at = Math.max(l.at, at);
        continue;
      }
      // The lineage's root: crew's `lineage`, else the parent's lineage through `revises`, else this pid (a root).
      const parent = str(p.revises) ? byPid.get(p.revises) : undefined;
      const lineageId = str(p.lineage) ? p.lineage : parent !== undefined && parent.lineage !== '' ? parent.lineage : pid;
      order.push(pid);
      byPid.set(pid, { lineage: lineageId, state: 'open' });
      supersedeOthers(pid);
      const v: JobVersion = { pid, turnId, at, proposal: p };
      const held = lineages.get(lineageId);
      if (held === undefined) {
        lineages.set(lineageId, {
          lineage: lineageId, versions: [v], head: v, state: 'open', revisingTurn: null, note: null, decision: null,
          result: null, accepted: null, acceptingAt: null, decidedAt: null, runId: null, offers: [], decisions: [], marks: [], at,
        });
      } else {
        const prev = held.head.proposal;
        held.versions.push(v);
        held.head = v;
        held.state = 'open';
        held.revisingTurn = null;
        held.note = null;
        held.decision = null;
        held.result = null;
        held.accepted = null;
        held.acceptingAt = null;
        held.decidedAt = null;
        // A new version has launched nothing yet: a reshape's replacement is not its predecessor's run.
        held.runId = null;
        held.at = Math.max(held.at, at);
        if (str(p.answers) && p.answers !== '') {
          const n = held.versions.length;
          const what = changedWords(prev, p);
          held.marks = held.marks.filter((m) => m.turnId !== p.answers);
          held.marks.push({ turnId: p.answers, at, kind: 'changed', version: n, text: `Changed the job to v${n}${what !== null ? `: ${what}` : ''}` });
        }
      }
    } else if (r['kind'] === 'proposal_revising' || r['kind'] === 'proposal_released') {
      const pid = r['pid'];
      if (!str(pid)) continue;
      const e = byPid.get(pid);
      const l = e === undefined ? undefined : lineages.get(e.lineage);
      if (e === undefined || l === undefined || l.head.pid !== pid) continue;
      if (r['kind'] === 'proposal_revising') {
        if (e.state !== 'open') continue;
        e.state = 'revising';
        l.state = 'revising';
        l.revisingTurn = turnId;
        l.at = Math.max(l.at, at);
      } else {
        if (e.state !== 'revising') continue;
        e.state = 'open';
        l.state = 'open';
        l.revisingTurn = null;
        const note = str(r['note']) ? r['note'] : null;
        l.note = note;
        // The hold's end changed what the passage says (its note): it sits after the reply that ended it.
        l.at = Math.max(l.at, at);
        // The hold ended without a new version: the person's message changed nothing (a revision that was published
        // supersedes the parent first, so its mark is the "changed" one above).
        if (turnId !== '' && !l.marks.some((m) => m.turnId === turnId)) {
          l.marks.push({ turnId, at, kind: 'unchanged', version: l.versions.length, text: note ?? 'Nothing changed' });
        }
      }
    } else if (r['kind'] === 'proposal_accepting') {
      const pid = r['pid'];
      const e = str(pid) ? byPid.get(pid) : undefined;
      const l = e === undefined ? undefined : lineages.get(e.lineage);
      if (e === undefined || l === undefined || l.head.pid !== pid || e.state === 'decided') continue;
      e.state = 'accepting';
      l.state = 'accepting';
      l.revisingTurn = null;
      l.acceptingAt = at;
      l.accepted = isJobProposal(r['resolution']) ? r['resolution'] : null;
      const identity = r['identity'];
      if (isObj(identity) && str(identity['runId'])) l.runId = identity['runId'];
    } else if (r['kind'] === 'proposal_decided') {
      const pid = r['pid'];
      const e = str(pid) ? byPid.get(pid) : undefined;
      const l = e === undefined ? undefined : lineages.get(e.lineage);
      if (e === undefined || e.state === 'decided' || (r['decision'] !== 'go' && r['decision'] !== 'not_now') || !isResult(r['result'] ?? null)) continue;
      e.state = 'decided';
      if (l === undefined || l.head.pid !== pid) continue;
      l.state = 'decided';
      l.revisingTurn = null;
      l.decision = r['decision'];
      l.result = (r['result'] ?? null) as ProposalResult | null;
      l.decidedAt = at;
      if (l.result !== null && !l.result.stub) l.runId = l.result.runId;
      const vix = l.versions.findIndex((x) => x.pid === pid);
      if (vix >= 0) l.decisions.push({ pid: String(pid), version: vix + 1, decision: l.decision!, at, runId: l.result !== null && !l.result.stub ? l.result.runId : null, stub: l.result?.stub === true });
    } else if (r['kind'] === 'plan_offer') {
      const o = r['offer'];
      if (!isOffer(o)) continue;
      const e = byPid.get(o.pid);
      const l = e === undefined ? undefined : lineages.get(e.lineage);
      if (l === undefined) continue;
      l.offers = [...l.offers.filter((x) => x.runId !== o.runId), o];
      l.at = Math.max(l.at, at);
    }
  }
  return [...lineages.values()];
}

// ── The state the passage draws ───────────────────────────────────────────────────────────────────────────────────

export type JobPhase =
  | 'proposed' | 'asking' | 'revising' | 'swapPending' | 'coming' | 'notStarted' | 'replaced'
  | 'starting' | 'interrupted' | 'stub'
  | 'planning' | 'planHeld' | 'replanning' | 'running' | 'gate' | 'runQuestion'
  | 'delivered' | 'stopped' | 'failed';

/** What the launched run looks like now, from the existing stores (one read each; `jobView` stays pure). */
export interface JobRunInputs {
  /** The run as the runs read holds it; `null` before it is listed. */
  view: SessionView | null;
  /** The run's open gate (the gate store's), or `null`. */
  gate: { ord: number; receivedAt: number; gateKind?: string | undefined; prompt: string } | null;
  /** The plan the open plan gate holds (`usePlanGate`), with whether the read was made for THIS gate instance. */
  plan: { ord: number; planRev: number; steps: JobPlanStep[]; changed?: string | null; fresh: boolean } | null;
  /** The plan gate is known open but its read for this instance is still on its way. */
  planReading: boolean;
  /** The open gate's kind is not known yet (no live frame named it, the team read has not answered): a run launched
   *  from a proposal fails CLOSED here, as a plan still being read, never as a gate answered without `planRev`. */
  planUnknown: boolean;
  /** An answer to this run's gate is being sent or was just sent (the shared gate-action state). */
  answering: boolean;
  /** `capabilities.reshapeRun`: a plan offer's Start again can be sent. */
  reshapeOn: boolean;
  /** A plan approval has been decided on this run (the team rows): the work is past its plan. */
  planDecided: boolean;
  /** This tab sent the plan of this revision back (a send-back); `null` = none known. */
  sentBack: number | null;
  /** A run question (elicitation) is open. */
  question: boolean;
  /** The undo queue's pending decision for this run, if any (studio's own receipt, never a crew record). */
  pending: { id: number; queuedAt: number; dueAt: number; verb: string } | null;
}

export const NO_RUN: JobRunInputs = { view: null, gate: null, plan: null, planReading: false, planUnknown: false, answering: false, reshapeOn: true, planDecided: false, sentBack: null, question: false, pending: null };

/** One step of the held plan as the passage outlines it, every word from the plan record. */
export interface JobPlanStep {
  id: string | null;
  label: string;
  /** The step's own instructions, first line (crew's plan record), or `null`. */
  detail: string | null;
  /** The step raises a human gate: it asks the person always, or only if its check fails (`GateSpec`); `null` = never
   *  (an automatic gate, or none). */
  asks: 'always' | 'if-fails' | 'maybe' | null;
  /** The floor added it for this risk (not the lead). */
  floor: boolean;
  /** New in this revision (not in the revision before it): washed, "what changed". */
  added: boolean;
}

type Row = { event_id: number; event_type: string; payload: Record<string, unknown>; emitted_at?: number };
const strOf = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** What a step's raised gate asks of the person (`GateSpec`): `auto` asks nothing. */
function asksOf(gate: unknown): JobPlanStep['asks'] {
  if (gate === 'consent_before') return 'always';
  if (typeof gate === 'object' && gate !== null) {
    if ('human_confirm' in gate) return (gate as { human_confirm?: { unconditional?: unknown } }).human_confirm?.unconditional === true ? 'always' : 'maybe';
    if ('human_confirm_if' in gate) return 'if-fails';
  }
  return null;
}

/**
 * The held plan's steps, enriched from the team record (`plan.proposed`): the step's instructions as its detail, a
 * raised gate as "asks you", a floor step as such, and what is new against the revision before it ("Plan v2: added
 * Roll back if parity fails"). The order and the step list are the plan gate's own (`steps`, floor steps in place);
 * a step the record cannot describe keeps its name only.
 */
export function enrichPlan(steps: ReadonlyArray<{ id: string | null; catalog: string | null; label: string }>, rows: readonly Row[], planRev: number, floorAdded: readonly string[] = []): { steps: JobPlanStep[]; changed: string | null } {
  // The proposal the held gate holds: the newest `plan.proposed` recorded before the gate for THIS revision opened, and
  // never one crew refused; its predecessor the one before it. A later or refused proposal never describes this plan.
  const gateRow = [...rows].filter((r) => r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval' && r.payload['plan_rev'] === planRev)
    .sort((a, b) => a.event_id - b.event_id).pop();
  const refused = new Set(rows.filter((r) => r.event_type === 'wicked.team.plan.refused').map((r) => String(r.payload['proposal_id'])));
  // No gate on record for this revision yet (the team record lags the plan read): nothing describes it but its names.
  if (gateRow === undefined) return { steps: steps.map((s) => ({ id: s.id, label: s.label, detail: null, asks: null, floor: false, added: false })), changed: null };
  const proposed = rows.filter((r) => r.event_type === 'wicked.team.plan.proposed' && r.event_id < gateRow.event_id
    && !(typeof r.payload['proposal_id'] === 'string' && refused.has(r.payload['proposal_id']))).sort((a, b) => a.event_id - b.event_id);
  const stepsOf = (r: Row | undefined): Array<Record<string, unknown>> => (Array.isArray(r?.payload['steps']) ? (r!.payload['steps'] as unknown[]).filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []);
  const held = proposed[proposed.length - 1];
  const before = proposed.length > 1 ? proposed[proposed.length - 2] : undefined;
  const byId = new Map(stepsOf(held).map((st) => [strOf(st['id']) ?? strOf(st['catalog']) ?? '', st]));
  const prevIds = before === undefined ? null : new Set(stepsOf(before).map((st) => strOf(st['id']) ?? strOf(st['catalog']) ?? ''));
  const out = steps.map((s): JobPlanStep => {
    const rec = s.id !== null ? byId.get(s.id) : undefined;
    const instr = strOf(rec?.['instructions']);
    const first = instr === null ? null : instr.split('\n')[0]!.trim();
    return {
      id: s.id,
      label: s.label,
      detail: first === null || first === '' ? null : first.length > 90 ? `${first.slice(0, 89).trimEnd()}…` : first,
      asks: asksOf(rec?.['gate']),
      floor: rec?.['added_by'] === 'floor' || (s.catalog !== null && floorAdded.includes(s.catalog) && rec === undefined),
      added: prevIds !== null && planRev > 1 && s.id !== null && !prevIds.has(s.id),
    };
  });
  const added = out.filter((s) => s.added).map((s) => s.label);
  const removed = prevIds === null || planRev <= 1 ? [] : [...prevIds].filter((id) => id !== '' && !steps.some((s) => s.id === id));
  const parts = [...(added.length > 0 ? [`added ${added.join(', ')}`] : []), ...(removed.length > 0 ? [`removed ${removed.length} step${removed.length === 1 ? '' : 's'}`] : [])];
  return { steps: out, changed: parts.length > 0 ? `Plan v${planRev}: ${parts.join('; ')}` : null };
}

/**
 * Whether the lead is re-planning on crew's record (a send-back answered in ANY tab): the newest plan decision on the
 * team record is an amended one, nothing was accepted or held since, and the step the gate stood before has not
 * started. Returns the revision sent back, or `null`.
 */
export function replanningOnRecord(rows: readonly Row[], units: ReadonlyArray<{ ord: number; status: string }>): number | null {
  const sorted = [...rows].sort((a, b) => a.event_id - b.event_id);
  const opened = new Map<string, { rev: number; ord: number }>();
  for (const r of sorted) {
    if (r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval') {
      // The work the plan gate stands before: its `reviewing_ord` (the envelope's `ord` is nullable), else the envelope's.
      const ord = typeof r.payload['reviewing_ord'] === 'number' ? r.payload['reviewing_ord'] : typeof r.payload['ord'] === 'number' ? r.payload['ord'] : null;
      opened.set(String(r.payload['gate_id']), { rev: typeof r.payload['plan_rev'] === 'number' ? r.payload['plan_rev'] : 0, ord: ord ?? -1 });
    }
  }
  const decided = sorted.filter((r) => r.event_type === 'wicked.team.gate.decided' && r.payload['kind'] === 'plan_approval');
  const last = decided[decided.length - 1];
  if (last === undefined || last.payload['decision'] !== 'human_amended') return null;
  const gate = opened.get(String(last.payload['gate_id']));
  if (gate === undefined) return null;
  const since = sorted.some((r) => r.event_id > last.event_id && (r.event_type === 'wicked.team.plan.accepted'
    || (r.event_type === 'wicked.team.gate.opened' && r.payload['kind'] === 'plan_approval')));
  if (since) return null;
  // Only while the work the gate stood before is on record and has not started.
  const work = units.find((u) => u.ord === gate.ord);
  if (work === undefined || work.status !== 'pending') return null;
  return gate.rev;
}

/** A tick: one dim line for a state the job reached or an act of the person's (rev 6 §2.7.1), from crew's records. */
export interface JobTick { key: string; at: number; text: string }

/**
 * The job's ticks, in time order, each from a record: the proposal's decision ("You started the job"), and from the
 * run's team record each plan revision held ("Codex's plan, v1, is ready") and how it was answered ("You approved plan
 * v2", "You sent plan v1 back", "You stopped the job at plan v1"). A queued answer in its undo window is never a tick:
 * it has no record until it is sent.
 */
export function jobTicks(l: JobLineage, rows: readonly Row[] | ReadonlyArray<{ runId: string; rows: readonly Row[]; lead?: string }>, lead: string): JobTick[] {
  // Each run the lineage launched has its own team record and its own lead (a reshape replaces both): kept apart.
  const runs = rows.length > 0 && 'runId' in (rows[0] as object) ? rows as ReadonlyArray<{ runId: string; rows: readonly Row[]; lead?: string }> : [{ runId: '', rows: rows as readonly Row[] }];
  const out = jobDecisionTicks(l);
  for (const run of runs) out.push(...runTicks(l.lineage, run.runId, run.rows, ('lead' in run && run.lead !== undefined) ? run.lead : lead));
  return out.sort((a, b) => a.at - b.at);
}

function jobDecisionTicks(l: JobLineage): JobTick[] {
  const out: JobTick[] = [];
  // Every decision the lineage recorded (a reshape's replacement keeps its predecessor's), keyed by its own pid.
  for (const d of l.decisions) {
    if (d.decision === 'go' && d.stub) continue; // the test configuration started nothing: no "started" tick
    out.push({ key: `${l.lineage}:${d.decision}:${d.pid}`, at: d.at, text: d.decision === 'go' ? 'You started the job' : 'You chose Not now' });
  }
  return out;
}

function runTicks(lineage: string, runId: string, rows: readonly Row[], lead: string): JobTick[] {
  const out: JobTick[] = [];
  const sorted = [...rows].sort((a, b) => a.event_id - b.event_id);
  const revOf = new Map<string, number>();
  for (const r of sorted) {
    if (r.payload['kind'] !== 'plan_approval') continue;
    const at = typeof r.emitted_at === 'number' ? r.emitted_at : null;
    if (at === null) continue; // no time on record: no tick (never placed by guess)
    if (r.event_type === 'wicked.team.gate.opened') {
      const rev = typeof r.payload['plan_rev'] === 'number' ? r.payload['plan_rev'] : null;
      if (rev === null) continue;
      revOf.set(String(r.payload['gate_id']), rev);
      out.push({ key: `${lineage}:${runId}:plan:${rev}:${r.event_id}`, at, text: `${lead}’s plan, v${rev}, is ready` });
    } else if (r.event_type === 'wicked.team.gate.decided') {
      const rev = revOf.get(String(r.payload['gate_id']));
      if (rev === undefined) continue;
      const d = r.payload['decision'];
      // An amended decision's own outcome: whichever came FIRST after it, an acceptance (approved with changes) or a new
      // plan gate (sent back). Later history never rewrites it.
      const next = sorted.find((x) => x.event_id > r.event_id && (x.event_type === 'wicked.team.plan.accepted'
        || (x.event_type === 'wicked.team.gate.opened' && x.payload['kind'] === 'plan_approval')));
      const text = d === 'human_approved' || d === 'allow' ? `You approved plan v${rev}`
        : d === 'human_amended' ? (next?.event_type === 'wicked.team.plan.accepted' ? `You approved plan v${rev} with your changes` : `You sent plan v${rev} back`)
          : d === 'human_rejected' || d === 'deny' ? `You stopped the job at plan v${rev}` : null;
      if (text !== null) out.push({ key: `${lineage}:${runId}:answer:${rev}:${r.event_id}`, at, text });
    }
  }
  return out;
}

/** The press target a reply is bound to (§2.7.3 rule 6): a press counts only for what it began on. */
export type JobReplyId = 'start' | 'not_now' | 'go_again' | `suggestion:${number}` | `choice:${number}` | 'approve' | 'change' | 'stop'
  | `offer:${string}:${'send_back' | 'reshape' | 'dismiss'}` | 'undo';

export interface JobReply {
  id: JobReplyId;
  label: string;
  /** What the press answers: a proposal pid, `plan:<run>:<ord>:<planRev>`, `offer:<id>`, `queued:<id>`. A press whose
   *  target changed between down and up sends nothing. */
  target: string;
  enabled: boolean;
  /** Why it is held, said beside it (never a bare disabled button). */
  held?: string;
  tone: 'go' | 'plain' | 'quiet';
  /** It binds the composer instead of sending (Change, a typed question answer). */
  binds?: true;
}

export interface JobStepRow { ord: number; label: string; seat: string | null; state: 'done' | 'skipped' | 'failed' | 'now' | 'waiting' | 'todo' }

/** The fold budget (§2.8.1, Q45): one fold line, the current step, the next and a count. Counts from recorded
 *  outcomes, never from position. */
export interface JobProgress {
  total: number;
  done: number;
  notNeeded: number;
  failed: number;
  last: string | null;
  current: JobStepRow | null;
  next: JobStepRow | null;
  more: number;
  rows: JobStepRow[];
}

export interface JobView {
  lineage: string;
  phase: JobPhase;
  /** 1-based proposal version (the head's index in its lineage). */
  version: number;
  /** The margin's label: "what Start runs" before Start, "the job" after. */
  label: string;
  /** The margin's version: "v2", or "plan v2" once a plan is held. */
  versionLabel: string;
  /** The proposal drawn: what Go accepted once accepting or started; the head otherwise. */
  proposal: JobProposal;
  /** The previous version (the change wash's base), `null` for v1. */
  previous: JobProposal | null;
  /** crew's notes, then the lineage's hold note. */
  notes: string[];
  sketch: string[] | null;
  sketchAsks: boolean[];
  question: ProposalQuestion | null;
  suggestions: ProposalSuggestion[];
  /** The tokens are drawn as tokens (proposal phases only; a started job's tokens are plain facts). */
  tokensLive: boolean;
  /** The tokens are held (a change is in flight): focusable, but nothing opens. */
  tokensHeld: boolean;
  plan: { ord: number; planRev: number; steps: JobPlanStep[]; changed: string | null } | null;
  progress: JobProgress | null;
  /** The run the job launched. */
  runId: string | null;
  /** Plan offers that answer the plan held now (same ord + planRev). */
  offers: ChatPlanOffer[];
  /** Why an offer's choices can't be pressed now (the same holds as Approve), or `null`. */
  offerHeld: string | null;
  /** Why Start again can't be sent (no reshape route), or `null`. */
  reshapeHeld: string | null;
  replies: JobReply[];
  /** The headline of the state, for the region's name and the live region. */
  status: string;
  /** Needs the person now (the needs-you colour). */
  needsYou: boolean;
  checks: Array<{ id: string; label: string }>;
}

/** Why the held plan's answers are held now, or `undefined` when they can be pressed. */
function planHold(run: JobRunInputs): string | undefined {
  if (run.pending !== null) return 'your answer is queued';
  if (run.answering) return 'your answer is being sent';
  if (run.plan === null || !run.plan.fresh || run.planReading || run.planUnknown) return 'reading the plan…';
  return undefined;
}

/** A short digest of a string (FNV-1a), for press targets: equal text, equal digest. */
function digest(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}

/** What a Start launches beyond what it shows: a press is bound to these too (a re-resolution onto another repository
 *  of the same name, another project, other inputs or another catalog revision is another target). */
const LAUNCH_KEYS = ['repoRefs', 'repos', 'filedIn', 'brief', 'words', 'details', 'inputs', 'launch', 'catalogRev', 'resolution', 'skipQe', 'powerChoice'] as const;

/** The press target of a proposal: its pid and a digest of everything a press on it answers. */
export function proposalTarget(p: JobProposal): string {
  const r = p as unknown as Record<string, unknown>;
  return `${p.pid}#${digest(JSON.stringify([p.sentence, p.question ?? null, p.suggestions ?? [], p.blocked, p.sketch ?? null, p.gate ?? null, p.seats ?? null, p.what, p.shape ?? null, LAUNCH_KEYS.map((k) => r[k] ?? null)]))}`;
}

/** The plain words of the catalog's check ids. */
export const CHECK_WORDS: Readonly<Record<CatalogGateId, string>> = {
  'qe-acceptance': 'QE acceptance',
  parity: 'Parity',
  'cited-findings': 'Cited findings',
  'fidelity-to-source': 'Fidelity to source',
  'proposal-only': 'Proposal only',
  'evidence-floor': 'Evidence floor',
  'install-consent': 'Install consent',
  walkthrough: 'Walkthrough',
  pick: 'Your pick',
  'draft-floor': 'Draft floor',
  'traces-to-requirements': 'Traces to requirements',
  review: 'Review',
};

const TERMINAL = new Set(['completed', 'cancelled', 'failed']);

/** A unit's step name, as the chain words it (passed in to keep this module free of the chain model's imports). */
export type StepName = (u: SessionView['units'][number]) => string;

/** The fold budget from the run's units: recorded outcomes only. */
export function progressOf(view: SessionView, stepName: StepName, gateOrd: number | null): JobProgress {
  const units = [...view.units].sort((a, b) => a.ord - b.ord);
  const cursor = view.session.status === 'executing' ? units[view.session.unit_ix] : undefined;
  const nowOrd = gateOrd ?? (cursor !== undefined && cursor.status !== 'done' && cursor.status !== 'rejected' ? cursor.ord : null);
  const rows: JobStepRow[] = units.map((u) => {
    const skipped = u.phase_status === 'skipped';
    // The step a gate waits at is waiting, whatever its last attempt's outcome (a retry or an escalation on a refused
    // step): the gate is anchored to its recorded ord.
    const state: JobStepRow['state'] = gateOrd !== null && u.ord === gateOrd ? 'waiting' : skipped ? 'skipped' : u.status === 'done' ? 'done' : u.status === 'rejected' ? 'failed'
      : u.ord === nowOrd ? 'now' : 'todo';
    return { ord: u.ord, label: stepName(u), seat: u.assigned_cli ?? null, state };
  });
  // The counts and the last outcome are the units' recorded outcomes, whatever the rows show as current (a refused step
  // a gate now waits at is still counted as failed).
  const outcome = (u: SessionView['units'][number]): 'done' | 'skipped' | 'failed' | null =>
    u.phase_status === 'skipped' ? 'skipped' : u.status === 'done' ? 'done' : u.status === 'rejected' ? 'failed' : null;
  const finished = units.filter((u) => outcome(u) !== null);
  const current = rows.find((r) => r.state === 'now' || r.state === 'waiting') ?? null;
  const after = rows.filter((r) => r.state === 'todo' && (current === null || r.ord > current.ord));
  return {
    total: rows.length,
    done: units.filter((u) => outcome(u) === 'done').length,
    notNeeded: units.filter((u) => outcome(u) === 'skipped').length,
    failed: units.filter((u) => outcome(u) === 'failed').length,
    last: finished.length > 0 ? stepName(finished[finished.length - 1]!) : null,
    current,
    next: after[0] ?? null,
    more: Math.max(0, after.length - 1),
    rows,
  };
}

/** "✓ 4 of 8 done · 1 not needed · last: Verify parity" — counts from the recorded outcomes. */
export function foldLine(p: JobProgress): string {
  const parts = [`${p.done} of ${p.total} done`];
  if (p.notNeeded > 0) parts.push(`${p.notNeeded} not needed`);
  if (p.failed > 0) parts.push(`${p.failed} failed`);
  if (p.last !== null) parts.push(`last: ${p.last}`);
  return parts.join(' · ');
}

function phaseOf(l: JobLineage, run: JobRunInputs, ui: { swapPending: string | null; starting: boolean }, now: number, startingMs: number): JobPhase {
  const p = l.head.proposal;
  if (l.state === 'superseded') return 'replaced';
  // A run crew records as launched from THIS version is the job's state, whatever an older transcript read still says
  // about the proposal (a refresh after Go that failed): no Start is offered over a launched run.
  const launched = run.view !== null && (l.state === 'open' || l.state === 'revising');
  if (l.state === 'decided' && l.decision === 'not_now') return 'notStarted';
  if (l.state === 'revising' && !launched) return 'revising';
  if (l.state === 'open' && !launched) {
    if (ui.swapPending === l.head.pid) return 'swapPending';
    if (p.coming !== undefined) return 'coming';
    if (p.question !== undefined && p.question !== null) return 'asking';
    return 'proposed';
  }
  // Accepting with no run on record yet: starting, or interrupted once the window passed. Once crew's run record shows
  // the launch, the run is drawn even before the decided record lands.
  if (l.state === 'accepting' && run.view === null) {
    return ui.starting || (l.acceptingAt !== null && now - l.acceptingAt < startingMs) ? 'starting' : 'interrupted';
  }
  if (l.result?.stub === true) return 'stub';
  const v = run.view;
  if (v === null) return 'starting';
  const status = v.session.status;
  if (status === 'completed') return 'delivered';
  if (status === 'cancelled') return 'stopped';
  if (status === 'failed') return 'failed';
  const planGate = run.plan !== null || run.gate?.gateKind === 'plan_approval' || run.planUnknown;
  if (status === 'awaiting_human') {
    if (planGate) {
      const rev = run.plan?.planRev ?? null;
      return run.sentBack !== null && (rev === null || rev <= run.sentBack) ? 'replanning' : 'planHeld';
    }
    if (run.question) return 'runQuestion';
    return 'gate';
  }
  if (run.question) return 'runQuestion';
  // A send-back is recorded as an amended plan decision: until a newer revision is held, the lead is re-planning.
  if (run.sentBack !== null) return 'replanning';
  if (!run.planDecided) return 'planning';
  return 'running';
}

const STATUS: Readonly<Record<JobPhase, string>> = {
  proposed: 'waiting for Start',
  asking: 'asking you',
  revising: 'updating from your message',
  swapPending: 'updating',
  coming: 'coming in a later release',
  notStarted: 'not started',
  replaced: 'replaced by a newer proposal',
  starting: 'starting',
  interrupted: 'interrupted before it started',
  stub: 'recorded, nothing started (test configuration)',
  planning: 'planning',
  planHeld: 'plan waiting for you',
  replanning: 're-planning with your words',
  running: 'running',
  gate: 'waiting for you',
  runQuestion: 'asking you',
  delivered: 'done',
  stopped: 'stopped',
  failed: 'failed',
};

/** The job's state, computed once from its records (§2.7.2), with the replies every place draws. */
export function jobView(l: JobLineage, run: JobRunInputs, opts: {
  stepName: StepName;
  /** A swap, suggestion or question choice this tab sent and crew has not answered (the pid it was made on). */
  swapPending?: string | null;
  /** This tab's own Go is in flight. */
  starting?: boolean;
  /** A decision this tab is sending on the proposal (Go or Not now). */
  deciding?: boolean;
  now?: number;
  startingMs?: number;
}): JobView {
  const now = opts.now ?? Date.now();
  const phase = phaseOf(l, run, { swapPending: opts.swapPending ?? null, starting: opts.starting === true }, now, opts.startingMs ?? 180_000);
  const head = l.head.proposal;
  const shown = l.accepted !== null && (l.state === 'accepting' || (l.state === 'decided' && l.decision === 'go')) ? l.accepted : head;
  const version = l.versions.length;
  const previous = version > 1 ? l.versions[version - 2]!.proposal : null;
  const preStart = phase === 'proposed' || phase === 'asking' || phase === 'revising' || phase === 'swapPending' || phase === 'coming';
  const plan = run.plan !== null && (phase === 'planHeld' || phase === 'replanning') ? { ord: run.plan.ord, planRev: run.plan.planRev, steps: run.plan.steps, changed: run.plan.changed ?? null } : null;
  const progress = run.view !== null && (phase === 'running' || phase === 'gate' || phase === 'runQuestion' || phase === 'delivered' || phase === 'stopped' || phase === 'failed')
    ? progressOf(run.view, opts.stepName, phase === 'gate' && run.gate !== null ? run.gate.ord : null) : null;
  // The proposal's target is its pid AND what it says: a re-resolution under the same pid (crew changed the sentence,
  // the question or the suggestions in place) is another target, so a press or a binding made on it never answers it.
  const pt = proposalTarget(head);
  const busy = opts.deciding === true;
  const replies: JobReply[] = [];
  const updating = 'waiting for your change to settle';
  if (phase === 'proposed') {
    const blocked = head.blocked;
    replies.push(blocked !== null
      ? { id: 'start', label: `Start v${version}`, target: pt, enabled: false, held: blocked, tone: 'go' }
      : { id: 'start', label: `Start v${version}`, target: pt, enabled: !busy, ...(busy ? { held: 'sending…' } : {}), tone: 'go' });
    replies.push({ id: 'not_now', label: 'Not now', target: pt, enabled: !busy, tone: 'plain' });
    (head.suggestions ?? []).slice(0, 2).forEach((s, i) => replies.push({ id: `suggestion:${i}`, label: s.label, target: `${pt}:s${i}`, enabled: !busy, tone: 'quiet' }));
  } else if (phase === 'asking') {
    (head.question?.choices ?? []).forEach((c, i) => replies.push({ id: `choice:${i}`, label: c.label, target: `${pt}:c${i}`, enabled: !busy, tone: i === 0 ? 'go' : 'plain', ...(needsWords(head.question!, c.edit) ? { binds: true as const } : {}) }));
    replies.push({ id: 'not_now', label: 'Not now', target: pt, enabled: !busy, tone: 'quiet' });
  } else if (phase === 'revising' || phase === 'swapPending') {
    replies.push({ id: 'start', label: 'Updating…', target: pt, enabled: false, held: updating, tone: 'go' });
    replies.push({ id: 'not_now', label: 'Not now', target: pt, enabled: !busy, tone: 'plain' });
  } else if (phase === 'coming') {
    replies.push({ id: 'not_now', label: 'Not now', target: pt, enabled: !busy, tone: 'plain' });
  } else if (phase === 'interrupted') {
    replies.push({ id: 'go_again', label: 'Go again', target: pt, enabled: !busy, tone: 'go' });
  } else if (phase === 'planHeld' && run.view !== null) {
    const p = run.plan;
    const key = p === null ? `plan:${run.view.session.id}:?` : `plan:${run.view.session.id}:${p.ord}:${p.planRev}`;
    const held = planHold(run);
    replies.push({ id: 'approve', label: p === null ? 'Approve plan' : `Approve plan v${p.planRev}`, target: key, enabled: held === undefined, ...(held !== undefined ? { held } : {}), tone: 'go' });
    replies.push({ id: 'change', label: 'Change', target: key, enabled: held === undefined, ...(held !== undefined ? { held } : {}), tone: 'plain', binds: true });
  } else if (phase === 'replanning') {
    const n = run.plan?.planRev ?? run.sentBack ?? 0;
    const key = run.view === null ? pt : `plan:${run.view.session.id}:${run.plan?.ord ?? -1}:${n}`;
    replies.push({ id: 'approve', label: `Approve plan v${n}`, target: key, enabled: false, held: 'no version can be approved while it re-plans', tone: 'go' });
    replies.push({ id: 'change', label: 'Change', target: key, enabled: false, tone: 'plain' });
  } else if ((phase === 'planning' || phase === 'running') && run.view !== null) {
    replies.push({ id: 'stop', label: 'Stop the job', target: `run:${run.view.session.id}`, enabled: true, tone: 'quiet' });
  }
  // Offers answer only the plan held now: the same ord and planRev (an offer for another version is never pressable).
  const offers = phase === 'planHeld' && run.plan !== null
    ? l.offers.filter((o) => o.runId === run.view?.session.id && o.ord === run.plan!.ord && o.planRev === run.plan!.planRev) : [];
  // An offer's choices are held exactly as Approve is (a queued answer, a read not made for this gate).
  const offerHeld = phase === 'planHeld' ? planHold(run) ?? null : 'the plan isn’t held now';
  const runId = l.runId;
  const status = phase === 'planHeld' && run.plan !== null ? `plan v${run.plan.planRev} waiting for you` : STATUS[phase];
  return {
    lineage: l.lineage,
    phase,
    version,
    label: preStart || phase === 'notStarted' || phase === 'replaced' ? 'what Start runs' : 'the job',
    versionLabel: plan !== null ? `plan v${plan.planRev}` : `v${version}`,
    proposal: shown,
    previous,
    notes: [...(shown.sentence?.notes ?? []), ...(l.note !== null && preStart ? [l.note] : [])],
    sketch: shown.sketch !== undefined ? shown.sketch.steps.map((s) => s.label) : null,
    sketchAsks: shown.sketch !== undefined ? shown.sketch.steps.map((s) => s.asks) : [],
    question: phase === 'asking' ? head.question ?? null : null,
    suggestions: phase === 'proposed' ? (head.suggestions ?? []).slice(0, 2) : [],
    tokensLive: phase === 'proposed' || phase === 'asking' || phase === 'swapPending' || phase === 'revising',
    tokensHeld: phase === 'swapPending' || phase === 'revising',
    plan,
    progress,
    runId,
    offers,
    offerHeld,
    reshapeHeld: run.reshapeOn ? null : 'this version of Studio’s service can’t start it again as another job',
    replies,
    status,
    needsYou: phase === 'asking' || phase === 'planHeld' || phase === 'gate' || phase === 'runQuestion' || phase === 'interrupted',
    checks: (shown.gate ?? []).map((id) => ({ id, label: CHECK_WORDS[id] ?? id })),
  };
}

/** Whether a question's choice is answered with typed words (a QE skip's reason, a missing text input): its edit has
 *  the question's `input` path, which the person's words fill. */
export function needsWords(q: ProposalQuestion, edit: ProposalRevisionEdits): boolean {
  if (q.input === undefined) return false;
  const path = q.input.edit;
  if (path === 'skipQe.reason') return edit.skipQe !== undefined;
  const id = path.slice('inputs.'.length);
  return edit.inputs !== undefined && id in edit.inputs;
}

/** The choice's edit with the person's words put where the question's `input` says (a copy; the record is untouched). */
export function withWords(q: ProposalQuestion, edit: ProposalRevisionEdits, words: string): ProposalRevisionEdits {
  const text = words.trim();
  if (q.input === undefined) return edit;
  const path = q.input.edit;
  if (path === 'skipQe.reason') return { ...edit, skipQe: { reason: text } };
  const id = path.slice('inputs.'.length);
  return { ...edit, inputs: { ...(edit.inputs ?? {}), [id]: { kind: 'text', value: text } } };
}

/** The sentence's text split around its `{token id}` placeholders, in order (unknown ids are kept as text, never
 *  dropped: crew's words are drawn whole). */
export function sentenceParts(text: string, tokens: readonly ProposalToken[]): Array<{ text: string } | { token: ProposalToken }> {
  const byId = new Map(tokens.map((t) => [t.id, t]));
  const out: Array<{ text: string } | { token: ProposalToken }> = [];
  const re = /\{([^{}]+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const t = byId.get(m[1]!);
    if (t === undefined) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ token: t });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The sentence as plain words (its tokens' labels in place): the region's name and the settled line. */
export function sentenceWords(p: JobProposal): string {
  const s = p.sentence;
  if (s === undefined) return p.what.label;
  return sentenceParts(s.text, s.tokens).map((x) => ('token' in x ? x.token.label : x.text)).join('').trim();
}

/** The region's accessible name (§2.8.6): "wicked, what Start runs: Migrate · Move, version 2". */
export function regionName(v: JobView): string {
  const what = v.proposal.what.label;
  return `wicked, ${v.label}: ${what}, ${v.plan !== null ? `plan version ${v.plan.planRev}` : `version ${v.version}`}, ${v.status}`;
}

/** Whether the job is over (delivered, stopped, failed, not started, replaced, or recorded only). */
export function jobSettled(phase: JobPhase): boolean {
  return phase === 'delivered' || phase === 'stopped' || phase === 'failed' || phase === 'notStarted' || phase === 'replaced' || phase === 'stub';
}

/** The settled one-liner of a job a later job followed (§2.8.1, Q45), from the same records as its delivery. It names
 *  what the record says and claims no check it cannot show. */
export function settledLine(v: JobView, delivered: { pr: string | null } | null): string {
  const what = v.proposal.what.label;
  switch (v.phase) {
    case 'delivered': return `Done. ${what}${delivered?.pr != null ? ` · ${delivered.pr}` : ''}`;
    case 'stopped': return `Stopped. ${what}${delivered?.pr != null ? ` · ${delivered.pr}` : ''}`;
    case 'failed': return `Failed. ${what}${delivered?.pr != null ? ` · ${delivered.pr}` : ''}`;
    case 'notStarted': return `Not started: ${what}`;
    case 'replaced': return `Replaced by a newer proposal: ${what} · nothing was started`;
    default: return `${what} · ${v.status}`;
  }
}

/** True while the run's work is live (not ended): the passage holds its run's decisions and progress. */
export function runLive(view: SessionView | null): boolean {
  return view !== null && !TERMINAL.has(view.session.status);
}

/** What to announce once when the job changed (§2.8.6): the new state or version, never the whole sentence. */
export function announceOf(prev: JobView | null, next: JobView): string | null {
  if (prev === null || prev.lineage !== next.lineage) return null;
  if (prev.version !== next.version) {
    const what = changedWords(prev.proposal, next.proposal);
    return `Changed to version ${next.version}${what !== null ? `: ${what}` : ''}`;
  }
  if (prev.plan?.planRev !== next.plan?.planRev && next.plan !== null) return `Plan version ${next.plan.planRev} is waiting for you`;
  if (prev.phase !== next.phase) return `The job is ${next.status}`;
  const newOffer = next.offers[next.offers.length - 1];
  if (newOffer !== undefined && !prev.offers.some((o) => o.id === newOffer.id)) return `wicked offers: ${newOffer.text}`;
  if (proposalTarget(prev.proposal) !== proposalTarget(next.proposal) && next.tokensLive) return 'wicked updated what Start runs';
  return null;
}
