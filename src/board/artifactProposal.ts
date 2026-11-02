import type { Ask, AskOption } from '../api/ask.js';
import type {
  ArtifactProposal,
  ArtifactProposalKind,
  ChatProposalRecord,
  ChatProposalView,
} from '../api/chatArtifacts-wire.js';
import { ApiError } from '../api/errors.js';

/**
 * A CHAT'S PROPOSALS (DES-CHAT-ARTIFACTS-001 §4.2-§4.3, slice A2): the transcript's `proposal`, `proposal_accepting`
 * and `proposal_decided` records folded into one card per proposal, with crew's own rules (a newer proposal supersedes
 * the open one; the same pid again replaces it; an answer stays answered). Every fact on the card is crew's: studio
 * draws it, and only the person's click (`POST /chats/:id/proposals/:pid`) answers it.
 */

/** One card: the folded view, where it sits in the thread, and its turn. */
export interface ProposalEntry extends ChatProposalView {
  pid: string;
  turnId: string;
  /** When crew first recorded it (daemon millis): the card sits there in the thread. */
  at: number;
}

const KINDS: ReadonlySet<string> = new Set(['proposal', 'proposal_accepting', 'proposal_decided']);

export function isProposalRecord(r: unknown): r is ChatProposalRecord {
  return typeof r === 'object' && r !== null && KINDS.has(String((r as { kind?: unknown }).kind));
}

/** The chat's proposals in the order crew first recorded them. Records of other kinds are ignored. */
export function foldChatProposals(records: readonly unknown[]): ProposalEntry[] {
  const byPid = new Map<string, ProposalEntry>();
  for (const r of records) {
    if (!isProposalRecord(r)) continue;
    if (r.kind === 'proposal') {
      const pid = r.proposal.pid;
      const held = byPid.get(pid);
      if (held !== undefined) {
        // A re-resolution (the document moved under it): the card shows the fresh facts, open again.
        if (held.state === 'open' || held.state === 'accepting') byPid.set(pid, { pid, turnId: r.turnId, at: held.at, proposal: r.proposal, state: 'open' });
        continue;
      }
      for (const v of byPid.values()) if (v.state === 'open') v.state = 'superseded';
      byPid.set(pid, { pid, turnId: r.turnId, at: r.at, proposal: r.proposal, state: 'open' });
    } else if (r.kind === 'proposal_accepting') {
      const v = byPid.get(r.pid);
      if (v === undefined || v.state === 'decided') continue;
      v.state = 'accepting';
      v.proposal = r.resolution;
    } else {
      const v = byPid.get(r.pid);
      if (v === undefined || v.state === 'decided') continue;
      v.state = 'decided';
      v.decision = r.decision;
      v.result = r.result;
      v.decidedAt = r.at;
    }
  }
  return [...byPid.values()];
}

/** The primary's words per kind (DES §4.2): a refine is "Make the change", a theme is "Preview". */
export const GO_WORDS: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Make it',
  demo: 'Make it',
  refine: 'Make the change',
  theme: 'Preview',
};

const GO_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Starts now; keep chatting',
  demo: 'Starts now; keep chatting',
  refine: 'Starts now; your edits are kept',
  theme: 'Nothing changes until you apply it',
};

const GO_CONSEQUENCE: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Studio creates the document and starts the job; it appears here as it’s made. One job at a time in a chat.',
  demo: 'Studio plans, records and reviews the video; it appears here as it’s made. One job at a time in a chat.',
  refine: 'Studio starts the revision; the new version appears here. Your own edits are kept. One job at a time in a chat.',
  theme: 'Studio shows the theme on the Theme page. Nothing is saved until you apply it.',
};

const CHANGE_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Brief, sources, helpers',
  demo: 'Address, audience, what to show',
  refine: 'Edit the ask',
  theme: 'On the Theme page',
};

const NOT_NOW_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Nothing is made',
  demo: 'Nothing is made',
  refine: 'The document stays as it is',
  theme: 'Nothing changes',
};

/**
 * Change something, routed per kind (DES §4.2): the New document form (create), an inline edit (refine), the Theme
 * page (theme) or New job's demo form (demo). Each arrives with its own slice; until then the card says what is coming
 * instead of opening a form that cannot answer the proposal.
 */
export function changeRoute(kind: ArtifactProposalKind): { kind: 'stub'; note: string } {
  const notes: Record<ArtifactProposalKind, string> = {
    create: 'Changing the brief, sources and helpers opens the New document form once documents can be made from a chat. For now, say what to change in the chat and a new proposal replaces this one.',
    refine: 'Editing the ask here comes with refining from a chat. For now, say what to change in the chat and a new proposal replaces this one.',
    theme: 'Opening the theme on the Theme page comes with theme proposals. For now, say what to change in the chat and a new proposal replaces this one.',
    demo: 'Changing the address, audience and what to show comes with demo videos from a chat. For now, say what to change in the chat and a new proposal replaces this one.',
  };
  return { kind: 'stub', note: notes[kind] };
}

/** The card's question: one choose ask, Go preselected (never focused), Change something, Not now. */
export function proposalAsk(e: ProposalEntry, o: { stub: boolean }): Ask {
  const p = e.proposal;
  const go: AskOption = {
    id: 'go',
    label: GO_WORDS[p.kind],
    sub: GO_SUB[p.kind],
    token: 'go',
    tone: 'primary',
    consequence: o.stub
      ? 'Test configuration: Studio records your click and starts nothing.'
      : GO_CONSEQUENCE[p.kind],
    ...(p.blocked !== null ? { disabled: `Blocked: ${p.blocked}` } : { recommended: true }),
  };
  const options: AskOption[] = [
    go,
    { id: 'change', label: 'Change something', sub: CHANGE_SUB[p.kind], token: 'change', tone: 'neutral', consequence: 'Change what is proposed before anything starts.' },
    { id: 'not_now', label: 'Not now', sub: NOT_NOW_SUB[p.kind], token: 'not_now', tone: 'neutral', consequence: 'Nothing starts. The proposal stays in the chat as declined.' },
  ];
  return {
    id: `proposal:${e.pid}`,
    host: 'chat',
    from: { kind: 'seat', id: p.seat, label: p.seat },
    prompt: p.what.label,
    kind: 'choose',
    options,
    default: p.blocked !== null ? 'change' : 'go',
    answeredBy: 'person',
    record: 'You chose: {label}',
  };
}

/** The one plain line an answered (or replaced, or interrupted) card collapses to; `null` while it is open. */
export function proposalRecordLine(e: ProposalEntry): string | null {
  if (e.state === 'open') return null;
  if (e.state === 'superseded') return 'A newer proposal replaced this one. Nothing was started.';
  if (e.state === 'accepting') return 'Interrupted before it was recorded as started.';
  return `You chose: ${e.decision === 'go' ? GO_WORDS[e.proposal.kind] : 'Not now'}`;
}

/** What Go did, in plain words, for the record line's meta. */
export function proposalResultWords(e: ProposalEntry): string | null {
  if (e.state !== 'decided' || e.decision !== 'go' || e.result === null || e.result === undefined) return null;
  if (e.result.stub) return 'Test configuration: recorded, nothing was made';
  return `Started · run ${e.result.runId.slice(0, 8)}`;
}

/** A refusal of `POST /chats/:id/proposals/:pid` as the card says it: crew's own sentence, and its view when it sent one. */
export function proposalRefusal(err: unknown): { words: string; code: string | null; view: ChatProposalView | null } {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { code?: unknown; view?: unknown };
    const code = typeof body.code === 'string' ? body.code : null;
    const view = typeof body.view === 'object' && body.view !== null ? (body.view as ChatProposalView) : null;
    const words = code === 'proposal_refused' ? 'Only the person who owns this chat can answer its proposals.'
      : err.status === 404 ? 'This proposal is no longer on Studio’s service.'
      : err.wire;
    return { words, code, view };
  }
  return { words: err instanceof Error ? err.message : String(err), code: null, view: null };
}

/** "Time, cost" with the parts crew knows; `null` when it knows none. */
export function proposalTimeWords(p: ArtifactProposal): string | null {
  const t = p.time;
  return t === null || t.label === '' ? null : t.label;
}
