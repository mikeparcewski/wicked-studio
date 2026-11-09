import type { Ask, AskOption } from '../api/ask.js';
import type {
  ArtifactProposal,
  ArtifactProposalKind,
  ChatProposalRecord,
  ChatProposalView,
  ProposalEdits,
  ProposalSource,
  ProtectedEdit,
} from '../api/chatArtifacts-wire.js';
import { ApiError } from '../api/errors.js';
import { patchValue, THEMES, type StudioAppearance, type ThemePatch, type ThemePatchKey } from '../theming/appearance.js';

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
  /** What a Go accepted (edits applied), kept beside the proposal as crew keeps it: the card shows it while accepting
   *  and once started, and the proposal as recorded otherwise (crew's `viewOf`). */
  accepted?: ArtifactProposal;
  /** When Go was recorded (`proposal_accepting`, daemon millis): a real launch takes seconds (A3), so a fresh one is
   *  "Starting it…", not interrupted. */
  acceptingAt?: number;
  /** (A5) The edits that Go was accepted with, as crew recorded them (`proposal_accepting.edits`): a refine's `allow`
   *  says which of the person's edits it was let change. `null` = none were sent. */
  acceptedEdits?: ProposalEdits | null;
}

const KINDS: ReadonlySet<string> = new Set(['proposal', 'proposal_accepting', 'proposal_decided']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
const KIND_SET: ReadonlySet<string> = new Set(['create', 'refine', 'theme', 'demo', 'onboard']);
const isSource = (s: unknown): boolean => isObj(s) && str(s['token']) && str(s['label']) && (s['status'] === 'ok' || s['status'] === 'struck')
  && (s['reason'] === undefined || str(s['reason']));
/**
 * A proposal shape the card can draw: every field the card reads, with its nullability (crew's; a malformed record is
 * skipped, never drawn half and never crashing the thread).
 */
export function isArtifactProposal(p: unknown): p is ArtifactProposal {
  if (!isObj(p) || !str(p['pid']) || !str(p['kind']) || !KIND_SET.has(p['kind']) || !str(p['seat'])) return false;
  const what = p['what'];
  if (!isObj(what) || !str(what['label']) || !str(what['title']) || !strOrNull(what['outcome'])) return false;
  if (!strOrNull(p['brief']) || !strOrNull(p['reason']) || !strOrNull(p['stops']) || !strOrNull(p['blocked'])) return false;
  if (!Array.isArray(p['sources']) || !p['sources'].every(isSource)) return false;
  if (!Array.isArray(p['repos']) || !p['repos'].every(str)) return false;
  const helpers = p['helpers'];
  if (helpers !== null && (!isObj(helpers) || !str(helpers['label']) || !Array.isArray(helpers['seats']) || !helpers['seats'].every(str))) return false;
  // (A3) What the answer form reads: the repositories' ids, a retry's document.
  const refs = p['repoRefs'];
  if (refs !== undefined && (!Array.isArray(refs) || !refs.every(str))) return false;
  if (p['artifactRef'] !== undefined && !str(p['artifactRef'])) return false;
  const time = p['time'];
  if (time !== null && (!isObj(time) || !str(time['label']))) return false;
  const filed = p['filedIn'];
  if (!isObj(filed) || !str(filed['label']) || !(filed['projectId'] === null || str(filed['projectId']))) return false;
  const target = p['target'];
  if (target !== undefined && (!isObj(target) || !str(target['ref']) || !str(target['title']) || typeof target['base'] !== 'number')) return false;
  const theme = p['theme'];
  if (theme !== undefined && (!isObj(theme) || !Array.isArray(theme['changes']) || !theme['changes'].every(str))) return false;
  // (A7) A theme is previewed and applied from its name and patch: both must be there and well formed.
  if (p['kind'] === 'theme' && (!isObj(theme) || !str(theme['name']) || theme['name'].trim() === '' || theme['name'].length > 60 || !isObj(theme['patch']))) return false;
  const demo = p['demo'];
  if (demo !== undefined && (!isObj(demo) || !str(demo['url']) || !strOrNull(demo['audience']) || !strOrNull(demo['show']))) return false;
  // (crew 0.18.2) An onboard card names the repository, where it goes and the project: all of it, well formed.
  const onboard = p['onboard'];
  if (p['kind'] === 'onboard' && !isOnboard(onboard)) return false;
  const touches = p['touches'];
  if (touches !== undefined && (!Array.isArray(touches) || !touches.every(str))) return false;
  // (A5) A refine's protected edits: each one the card can draw and the person can answer.
  const kept = p['protected'];
  return kept === undefined || (Array.isArray(kept) && kept.every(isProtectedEdit));
}

const isOnboard = (o: unknown): boolean => isObj(o) && str(o['url']) && str(o['name']) && strOrNull(o['checkout'])
  && strOrNull(o['projectId']) && strOrNull(o['projectName'])
  && (o['existing'] === null || (isObj(o['existing']) && str(o['existing']['id']) && str(o['existing']['name'])));

const PROTECTED_KINDS: ReadonlySet<string> = new Set(['text', 'attr', 'added', 'gone', 'order']);
const isProtectedEdit = (e: unknown): boolean =>
  isObj(e) && str(e['id']) && str(e['label']) && PROTECTED_KINDS.has(String(e['kind'])) && (e['wid'] === null || str(e['wid'])) && typeof e['touched'] === 'boolean';
const isResult = (r: unknown): boolean => r === null || (isObj(r) && str(r['runId']) && typeof r['stub'] === 'boolean');

export function isProposalRecord(r: unknown): r is ChatProposalRecord {
  if (!isObj(r) || !KINDS.has(String(r['kind'])) || typeof r['turnId'] !== 'string') return false;
  if (r['kind'] === 'proposal') return isArtifactProposal(r['proposal']);
  if (r['kind'] === 'proposal_accepting') return typeof r['pid'] === 'string' && isArtifactProposal(r['resolution']);
  return typeof r['pid'] === 'string' && (r['decision'] === 'go' || r['decision'] === 'not_now') && isResult(r['result']);
}

/** A view crew answered with (a decision, or a refusal's), when it is one the card can draw; else `null`. */
export function isProposalView(v: unknown): v is ChatProposalView {
  return isObj(v) && isArtifactProposal(v['proposal']) && ['open', 'accepting', 'decided', 'superseded'].includes(String(v['state']))
    && (v['decision'] === undefined || v['decision'] === 'go' || v['decision'] === 'not_now')
    && (v['result'] === undefined || isResult(v['result']))
    && (v['decidedAt'] === undefined || typeof v['decidedAt'] === 'number');
}

/**
 * The chat's proposals in the order crew first recorded them, folded exactly as crew folds them (`chat-proposals.ts`
 * `foldProposals`): the newest proposal is the chat's one open proposal (a new pid, or a re-resolution of the newest)
 * and supersedes every other open one; an older proposal re-resolved after a newer one exists is superseded; an
 * accepting (in-flight) one is not open; a decided or superseded one stays so. Records of other kinds, and malformed ones, are ignored.
 */
export function foldChatProposals(records: readonly unknown[]): ProposalEntry[] {
  const byPid = new Map<string, ProposalEntry>();
  for (const r of records) {
    if (!isProposalRecord(r)) continue;
    if (r.kind === 'proposal') {
      const pid = r.proposal.pid;
      const held = byPid.get(pid);
      if (held !== undefined && (held.state === 'decided' || held.state === 'superseded')) continue;
      // A re-resolution of an older proposal while a newer one exists never takes the chat back: it is superseded.
      if (held !== undefined && [...byPid.keys()].indexOf(pid) < byPid.size - 1) {
        held.state = 'superseded';
        continue;
      }
      for (const [other, v] of byPid) if (other !== pid && v.state === 'open') v.state = 'superseded';
      byPid.set(pid, { pid, turnId: r.turnId, at: held?.at ?? r.at, proposal: r.proposal, state: 'open' });
    } else if (r.kind === 'proposal_accepting') {
      const v = byPid.get(r.pid);
      if (v === undefined || v.state === 'decided') continue;
      v.state = 'accepting';
      v.accepted = r.resolution;
      v.acceptingAt = r.at;
      v.acceptedEdits = r.edits ?? null;
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

/**
 * What this tab knows is settled, per chat and pid: an answered or replaced proposal never reopens, whether the answer
 * came back on this card's own request or from a transcript read (another tab's answer). A stale read — an older
 * snapshot of the append-only transcript — is reconciled against it, so it can never redraw the controls.
 */
const settled = new Map<string, ProposalEntry>();
const settledKey = (chatId: string, pid: string): string => `${chatId}\u0000${pid}`;
const terminal = (s: ChatProposalView['state']): boolean => s === 'decided' || s === 'superseded';

/** Remember a settled view (from a response or a read). Open and accepting views are never remembered. */
export function noteSettled(chatId: string, e: ProposalEntry): void {
  if (terminal(e.state)) settled.set(settledKey(chatId, e.pid), e);
}

/** The entries as this tab should draw them: a settled one stays settled, whatever an older read says. */
export function reconcileProposals(chatId: string, entries: readonly ProposalEntry[]): ProposalEntry[] {
  return entries.map((e) => {
    if (terminal(e.state)) {
      noteSettled(chatId, e);
      return e;
    }
    return settled.get(settledKey(chatId, e.pid)) ?? e;
  });
}

/** Tests: forget what was settled. */
export function resetSettledProposals(): void {
  settled.clear();
}

/** The primary's words per kind (DES §4.2): a refine is "Make the change", a theme is "Preview". */
export const GO_WORDS: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Make it',
  demo: 'Make it',
  refine: 'Make the change',
  theme: 'Preview',
  onboard: 'Add it',
};

const GO_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Starts now; keep chatting',
  demo: 'Starts now; keep chatting',
  refine: 'Starts now; your edits are kept',
  theme: 'Nothing changes until you apply it',
  onboard: 'Clones it and starts onboarding',
};

const GO_CONSEQUENCE: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Studio creates the document and starts the job; it appears here as it’s made. One job at a time in a chat.',
  demo: 'Studio plans, records and reviews the video; it appears here as it’s made. One job at a time in a chat.',
  refine: 'Studio starts the revision; the new version appears here. Your own edits are kept. One job at a time in a chat.',
  theme: 'Studio shows the theme on the Theme page. Nothing is saved until you apply it.',
  onboard: 'Studio clones the repository to this computer, registers it, adds it to the project and starts onboarding (it builds the code map). Nothing happens until you choose.',
};

const CHANGE_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Brief, sources, helpers',
  demo: 'Address, audience, what to show',
  refine: 'Edit the ask',
  theme: 'Compare and apply',
  onboard: 'Say it in the chat',
};

/** Change something's label: a theme's is "Open in Theme" (DES §4.2, mockup e). */
const CHANGE_WORDS: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Change something',
  demo: 'Change something',
  refine: 'Change something',
  theme: 'Open in Theme',
  onboard: 'Change something',
};

const NOT_NOW_SUB: Readonly<Record<ArtifactProposalKind, string>> = {
  create: 'Nothing is made',
  demo: 'Nothing is made',
  refine: 'The document stays as it is',
  theme: 'Nothing changes',
  onboard: 'Nothing is cloned or registered',
};

/**
 * Change something, routed per kind (DES §4.2): the New document form (create), an inline edit (refine), the Theme
 * page (theme) or New job's demo form (demo). Each arrives with its own slice; until then the card says what is coming
 * instead of opening a form that cannot answer the proposal.
 */
export function changeRoute(kind: ArtifactProposalKind): { kind: 'form' } | { kind: 'theme' } | { kind: 'stub'; note: string } {
  // A3: a create opens New document in "answer this proposal" mode, under the card.
  if (kind === 'create') return { kind: 'form' };
  // A7: a theme opens the Theme page with the proposal previewed (compare, adjust, apply).
  if (kind === 'theme') return { kind: 'theme' };
  const notes: Record<Exclude<ArtifactProposalKind, 'create' | 'theme'>, string> = {
    refine: 'Editing the ask here comes with refining from a chat. For now, say what to change in the chat and a new proposal replaces this one.',
    demo: 'Changing the address, audience and what to show comes with demo videos from a chat. For now, say what to change in the chat and a new proposal replaces this one.',
    onboard: 'To change the address, the name or the project, say so in the chat: a new proposal replaces this one.',
  };
  return { kind: 'stub', note: notes[kind] };
}

/** A crew-made retry of a proposal-bound attempt that did not land (`<chat>:retry:<run>`, DES §6.2). */
export function isRetryProposal(p: ArtifactProposal): boolean {
  return p.sourceRunId !== undefined && p.sourceRunId !== '';
}

/** The primary's words for this proposal: Try again on a retry, else the kind's. */
export function goWords(p: ArtifactProposal): string {
  return isRetryProposal(p) ? 'Try again' : GO_WORDS[p.kind];
}

/** The card's question: one choose ask, Go preselected (never focused), Change something, Not now. A theme whose
 *  contrast fails (or can't be measured) offers neither Preview nor Open in Theme (`themeRefused`, DES §9). */
export function proposalAsk(e: ProposalEntry, o: { stub: boolean; themeRefused?: string | null }): Ask {
  const p = e.proposal;
  const refused = p.kind === 'theme' && o.themeRefused !== undefined && o.themeRefused !== null ? o.themeRefused : null;
  const go: AskOption = {
    id: 'go',
    label: goWords(p),
    // The test configuration starts nothing, and the option says so too (never "Starts now" beside that notice).
    sub: o.stub ? 'Records your click; nothing starts' : isRetryProposal(p) && p.kind === 'refine' ? 'Revises the latest version; your edits are kept'
      : p.onboard?.existing != null ? 'Adds it to the project; nothing is cloned' : GO_SUB[p.kind],
    token: 'go',
    tone: 'primary',
    consequence: o.stub
      ? 'Test configuration: Studio records your click and starts nothing.'
      : p.onboard?.existing != null ? `Studio adds ${p.onboard.existing.name} to ${p.onboard.projectName ?? 'the project'}. Nothing is cloned and no onboarding starts.` : GO_CONSEQUENCE[p.kind],
    ...(p.blocked !== null ? { disabled: `Blocked: ${p.blocked}` } : refused !== null ? { disabled: refused } : { recommended: true }),
  };
  const change: AskOption = {
    id: 'change', label: CHANGE_WORDS[p.kind], sub: CHANGE_SUB[p.kind], token: 'change', tone: 'neutral',
    consequence: p.kind === 'theme' ? 'The Theme page shows yours and the proposal side by side; nothing is saved until you apply it.' : 'Change what is proposed before anything starts.',
    ...(refused !== null ? { disabled: refused } : {}),
  };
  const options: AskOption[] = [
    go,
    change,
    { id: 'not_now', label: 'Not now', sub: NOT_NOW_SUB[p.kind], token: 'not_now', tone: 'neutral', consequence: 'Nothing starts. The proposal stays in the chat as declined.' },
  ];
  return {
    id: `proposal:${e.pid}`,
    host: 'chat',
    from: { kind: 'seat', id: p.seat, label: p.seat },
    prompt: p.what.label,
    kind: 'choose',
    options,
    default: refused !== null ? 'not_now' : p.blocked !== null ? 'change' : 'go',
    answeredBy: 'person',
    record: 'You chose: {label}',
  };
}

/** The facts the card draws: what was accepted while accepting and once started; the proposal as recorded otherwise. */
export function shownProposal(e: ProposalEntry): ArtifactProposal {
  return e.accepted !== undefined && (e.state === 'accepting' || (e.state === 'decided' && e.decision === 'go')) ? e.accepted : e.proposal;
}

/** The one plain line an answered (or replaced, or interrupted) card collapses to; `null` while it is open. */
/** How long a recorded Go reads as still starting (crew creates the document, snapshots its repositories and launches:
 *  seconds, up to a big clone). After it, an `accepting` proposal reads as interrupted, with Go again. */
export const PROPOSAL_STARTING_MS = 180_000;

/** Whether an `accepting` proposal is still starting: this tab's own Go is in flight, or Go was recorded moments ago. */
export function proposalStarting(e: ProposalEntry, now: number, inFlight: boolean): boolean {
  return e.state === 'accepting' && (inFlight || (e.acceptingAt !== undefined && now - e.acceptingAt < PROPOSAL_STARTING_MS));
}

export function proposalRecordLine(e: ProposalEntry, starting = false): string | null {
  if (e.state === 'open') return null;
  if (e.state === 'superseded') return 'A newer proposal replaced this one. Nothing was started.';
  if (e.state === 'accepting') return starting ? 'Starting it…' : 'Interrupted before it was recorded as started.';
  // A theme's Go is recorded when the person APPLIED it (a preview records nothing).
  if (e.proposal.kind === 'theme' && e.decision === 'go') return 'You applied this theme';
  return `You chose: ${e.decision === 'go' ? goWords(e.proposal) : 'Not now'}`;
}

/** What Go did, in plain words, for the record line's meta. */
export function proposalResultWords(e: ProposalEntry): string | null {
  if (e.state !== 'decided' || e.decision !== 'go' || e.result === null || e.result === undefined) return null;
  if (e.result.stub) return 'Test configuration: recorded, nothing was made';
  if (e.proposal.kind === 'theme') return 'Saved to your studio settings · no job was started';
  const ob = e.proposal.onboard;
  if (e.proposal.kind === 'onboard' && ob !== undefined) {
    return ob.existing !== null
      ? `Added to ${ob.projectName ?? 'the project'} · nothing was started`
      : `Added${ob.projectName !== null ? ` to ${ob.projectName}` : ''} · onboarding run ${e.result.runId.slice(0, 8)}`;
  }
  return `Started · run ${e.result.runId.slice(0, 8)}`;
}

// ── Theme proposals (slice A7, DES §9) ─────────────────────────────────────────────────────────────────────────────

const themeLabel = (id: string): string => THEMES.find((t) => t.id === id)?.label ?? id;

/**
 * Every key the patch changes, in words, against what the tab shows now: "Wicked Light → Wicked Dark", "action colour
 * hue 210, saturation 14, lightness 70", "Ambient on, still". A key the patch names with the value it already has says
 * so ("Already Wicked Dark").
 */
export function themeChangeWords(current: StudioAppearance, patch: ThemePatch): string[] {
  const out: string[] = [];
  const has = (k: ThemePatchKey): boolean => k in patch;
  const moved = (k: ThemePatchKey): boolean => has(k) && patch[k] !== patchValue(current, k);
  if (has('theme')) out.push(moved('theme') ? `${themeLabel(current.theme)} → ${themeLabel(patch.theme!)}` : `Already ${themeLabel(current.theme)}`);
  if (has('accent_h') || has('accent_s') || has('accent_l')) {
    const parts = [
      has('accent_h') ? `hue ${patch.accent_h}` : null,
      has('accent_s') ? `saturation ${patch.accent_s}` : null,
      has('accent_l') ? `lightness ${patch.accent_l}` : null,
    ].filter((x): x is string => x !== null);
    const same = !moved('accent_h') && !moved('accent_s') && !moved('accent_l');
    out.push(same ? `action colour unchanged (${parts.join(', ')})` : `action colour ${parts.join(', ')}`);
  }
  if (has('ambient') || has('ambient_still')) {
    const on = has('ambient') ? patch.ambient === true : current.ambient === true;
    const still = has('ambient_still') ? patch.ambient_still === true : current.ambient_still === true;
    // With Ambient off, its still flag changes nothing on screen: the words say what the person gets (coordinator copy
    // fix: "Ambient off (still when on)" read unclear).
    out.push(on ? `Ambient on${still ? ', still' : ''}` : has('ambient_still') ? 'Ambient off: no background motion' : 'Ambient off');
  }
  return out;
}

/** The one line on what a studio theme can't change (DES §9). */
export const THEME_LIMITS = 'Studio themes set light or dark, the action colour and Ambient. Fonts and spacing are fixed.';

/** "Proposed by Claude Code · checked by the contrast check · no second agent reviewed it" (DES §9, §15.2). */
export function themeDisclosure(seatName: string): string {
  return `Proposed by ${seatName} · checked by the contrast check · no second agent reviewed it`;
}

/** A refusal of `POST /chats/:id/proposals/:pid` as the card says it: crew's own sentence, and its view when it sent one. */
export function proposalRefusal(err: unknown): { words: string; code: string | null; view: ChatProposalView | null } {
  if (err instanceof ApiError) {
    const body = (err.body ?? {}) as { code?: unknown; view?: unknown };
    const code = typeof body.code === 'string' ? body.code : null;
    const view = isProposalView(body.view) ? body.view : null;
    // Crew's own sentence; only a bare 404 (an older daemon, a gone chat) gets studio's words.
    const words = err.status === 404 && code === null ? 'This proposal is no longer on Studio’s service.' : err.wire;
    return { words, code, view };
  }
  return { words: err instanceof Error ? err.message : String(err), code: null, view: null };
}

/** "Time, cost" with the parts crew knows; `null` when it knows none. */
export function proposalTimeWords(p: ArtifactProposal): string | null {
  const t = p.time;
  return t === null || t.label === '' ? null : t.label;
}

// ── New document in "answer this proposal" mode (slice A3, DES §4.2 Change something on a create) ─────────────────────

/** The proposal's repositories as the form keys them: the registry id when crew sent one, else the name. Two that share
 *  a name are told apart by their id in the label. */
export function repoKeysOf(p: ArtifactProposal): Array<{ key: string; label: string }> {
  return p.repos.map((name, i) => {
    const key = p.repoRefs?.[i] ?? name;
    const shared = p.repos.filter((n) => n === name).length > 1;
    return { key, label: shared && key !== name ? `${name} (${key})` : name };
  });
}

/** Whether a roster seat can be one of a proposal's two helpers: crew's own rule at Go (`rosterEligible`): enabled for
 *  councils, eligible for work, not signed out, not opt-in. */
export function proposalHelperEligible(seat: { enabled_for_council?: boolean } & Record<string, unknown>): boolean {
  return seat.enabled_for_council === true && seat['seat_eligible_for_work'] !== false && seat['auth'] !== 'signed_out' && seat['optIn'] !== true;
}

/** What the form edits. `project`: the target project id, `null` = Unfiled. `repos`: repository keys ({@link repoKeysOf}). */
export interface ProposalForm {
  title: string;
  brief: string;
  project: string | null;
  /** The source tokens the person keeps (struck ones never count). */
  sources: string[];
  repos: string[];
  helpers: string[];
}

/** The form as the proposal opens it. */
export function proposalFormOf(p: ArtifactProposal): ProposalForm {
  return {
    title: p.what.title,
    brief: p.brief ?? '',
    project: p.filedIn.projectId,
    sources: p.sources.filter((s) => s.status === 'ok').map((s) => s.token),
    // By registry id (two checkouts may share a name), the name only when crew sent no ids.
    repos: repoKeysOf(p).map((r) => r.key),
    helpers: [...(p.helpers?.seats ?? [])],
  };
}

/**
 * Each chip as the form shows it once a project is chosen: a run or document from another project is struck at once
 * ("not in Mikes"), before Go (crew re-checks the rest, the conversation and a `message:` source's records, at Go).
 */
export function formSources(p: ArtifactProposal, f: Pick<ProposalForm, 'project' | 'sources'>, projectLabel: (id: string | null) => string): Array<ProposalSource & { kept: boolean }> {
  const moved = f.project !== p.filedIn.projectId;
  return p.sources.map((s) => {
    if (s.status !== 'ok') return { ...s, kept: false };
    const tagged = s.token.startsWith('run:') || s.token.startsWith('doc:');
    if (moved && tagged && s.projectId !== undefined && s.projectId !== f.project) {
      return { ...s, status: 'struck' as const, reason: `not in ${projectLabel(f.project)}`, kept: false };
    }
    return { ...s, kept: f.sources.includes(s.token) };
  });
}

/** The typed edits a Go carries: only what the person changed, never a chip the project change struck. */
export function proposalFormEdits(p: ArtifactProposal, f: ProposalForm, projectLabel: (id: string | null) => string = (id) => id ?? 'Unfiled'): ProposalEdits {
  const was = proposalFormOf(p);
  const edits: ProposalEdits = {};
  if (f.title.trim() !== was.title.trim()) edits.title = f.title.trim();
  if (f.brief !== was.brief) edits.brief = f.brief;
  if (f.project !== was.project) {
    edits.project = f.project;
    // The kept repositories ride with a project change (even unchanged): crew then checks them as the person's choice
    // and refuses one outside the target, instead of silently cutting it.
    edits.repos = [...f.repos];
  }
  const usable = formSources(p, f, projectLabel).filter((s) => s.status === 'ok').map((s) => s.token);
  const kept = usable.filter((t) => f.sources.includes(t));
  if (kept.length !== usable.length) edits.sources = kept;
  const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));
  if (edits.repos === undefined && !sameSet(f.repos, was.repos)) edits.repos = [...f.repos];
  if (!sameSet(f.helpers, was.helpers)) edits.helpers = [...f.helpers];
  return edits;
}

// ── A refine keeps the person's own edits (slice A5, DES §6.1-6.2) ──────────────────────────────────────────────────────

/** A refine's protected edits as the card lists them: the ones the ask is about inline, the rest folded. */
export function protectedGroups(p: ArtifactProposal): { touched: ProtectedEdit[]; rest: ProtectedEdit[] } {
  const all = p.kind === 'refine' ? p.protected ?? [] : [];
  return { touched: all.filter((e) => e.touched), rest: all.filter((e) => !e.touched) };
}

/** The edits a refine's Go carries: `allow` names exactly the edits the person let change (and only ones on the card);
 *  none when they keep everything. */
export function refineGoEdits(p: ArtifactProposal, letChange: ReadonlySet<string>): ProposalEdits | undefined {
  const shown = new Set((p.protected ?? []).map((e) => e.id));
  const allow = [...letChange].filter((id) => shown.has(id));
  return allow.length > 0 ? { allow } : undefined;
}

/** What became of a started refine, from its run and the document's versions: `landed` only once a version made by that
 *  run is in the document (so "Kept your N edits" is never said before it lands), `failed` with crew's reason. */
export type RefineOutcome = { kind: 'landed'; version: number; kept: number | null } | { kind: 'failed'; reason: string } | { kind: 'pending' };

export function refineOutcome(
  run: { session: { id: string; landing_failed?: { reason?: unknown } | null } } | null,
  versions: ReadonlyArray<{ version: number; run_id?: string | null }> | null,
    /** How many of the person's edits the accepted Go kept, from crew's own accepting record; `null` = not known here (no
   *  record of it read yet), so nothing is claimed. */
  kept: number | null,
): RefineOutcome {
  if (run === null) return { kind: 'pending' };
  const failed = run.session.landing_failed;
  if (failed !== undefined && failed !== null) {
    const why = typeof failed.reason === 'string' && failed.reason.trim() !== '' ? failed.reason.trim() : 'it did not land';
    return { kind: 'failed', reason: why };
  }
  const landed = (versions ?? []).find((v) => v.run_id === run.session.id);
  return landed !== undefined ? { kind: 'landed', version: landed.version, kept } : { kind: 'pending' };
}

/** The one line a started refine says once its outcome is known. */
export function refineOutcomeLine(o: RefineOutcome): string | null {
  if (o.kind === 'landed') {
    return o.kept !== null && o.kept > 0 ? `v${o.version} made · kept your ${o.kept} edit${o.kept === 1 ? '' : 's'}` : `v${o.version} made`;
  }
  if (o.kind === 'failed') return `Not changed: ${o.reason}`;
  return null;
}

/** How many of the person's edits an accepted refine kept: its protected edits minus the ones its recorded `allow` let
 *  change. `null` when crew's accepting record is not in hand (a view from a response alone): never guessed. */
export function keptByAccepted(e: ProposalEntry): number | null {
  if (e.acceptingAt === undefined || e.accepted === undefined) return null;
  const ids = (e.accepted.protected ?? []).map((x) => x.id);
  const sent = e.acceptedEdits?.allow;
  const allow = new Set(Array.isArray(sent) ? sent.filter((x): x is string => typeof x === 'string') : []);
  return ids.filter((id) => !allow.has(id)).length;
}
