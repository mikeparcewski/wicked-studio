/**
 * The chat-artifacts wire, slices A1 and A2 (DES-CHAT-ARTIFACTS-001 §4, §5.1, §6.3, §14; `wicked-crew-api-types`
 * 0.169.0 and 0.170.0). A VERBATIM mirror of the contract blocks while studio's pin lags the release: when the pin
 * moves, these become re-exports from the package and this mirror goes. Two gates, read separately:
 * `GET /health.capabilities.chatArtifacts.context` for `ChatMessageBody.context` (an older daemon's message body is
 * strict, so it is never sent any of it), and `.proposals` for the proposal cards and their answer route.
 */

/** `GET /health.capabilities.chatArtifacts` (api-types 0.169.0): one flag per operation. */
export interface ChatArtifactsCapabilities {
  context: boolean;
  proposals: boolean;
  create: boolean;
  refine: boolean;
  theme: boolean;
  demo: boolean;
  /** (api-types 0.170.0) The daemon runs the chat-artifacts TEST configuration: Go records a stub dispatch and starts
   *  nothing. The card says so. */
  stub?: true;
  /** (api-types 0.171.0, A3) Under the test configuration, the kinds whose Go is still a stub (`create` is real since A3).
   *  Absent with `stub: true` = every kind (a daemon before the field). */
  stubOps?: ArtifactProposalKind[];
}

/** `ChatMessageBody.context` (api-types 0.169.0): what studio shows beside the message. */
export interface ChatMessageContext {
  /** The artifact on the surface the message was sent from (inline, pane, Made or full screen). */
  artifact?: ChatArtifactContext;
  /** The tab's effective appearance, sent when `chatArtifacts.theme` is advertised. */
  appearance?: ChatContextAppearance;
  /** Studio's page summary (the context pack), kept apart from the person's typed words. At most 32 KiB. */
  page?: string;
}

/** `ChatMessageContext.artifact`. */
export interface ChatArtifactContext {
  /** `<mount>/<doc>`: the mount is a project id or `_unfiled`. */
  ref: string;
  /** The version the person is looking at (≥ 1), read after the editor's in-flight writes finished. */
  version: number;
  /** The `data-wid` of each part the person selected (at most 16). */
  anchors?: string[];
}

/** `ChatMessageContext.appearance`. */
export interface ChatContextAppearance {
  theme?: string;
  accent_h?: number;
  accent_s?: number;
  accent_l?: number;
  ambient?: boolean;
  ambient_still?: boolean;
  previewOf?: string;
}

/** The Unfiled mount in an artifact ref (crew reads studio's `default` mount alias as it too). */
export const UNFILED_ARTIFACT_MOUNT = '_unfiled';
/** Crew's cap on selected parts per message. */
export const CONTEXT_ANCHORS_MAX = 16;
/** Crew's cap on `context.page`, in UTF-16 code units (crew counts characters). */
export const CONTEXT_PAGE_MAX = 32 * 1024;

const DOC = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const WID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

/** The artifact ref of a document in a project (`default` / empty = Unfiled); `null` when the ids cannot make one. */
export function artifactRefOf(projectId: string, docId: string | undefined): string | null {
  if (docId === undefined || !DOC.test(docId)) return null;
  const mount = projectId === '' || projectId === 'default' ? UNFILED_ARTIFACT_MOUNT : projectId;
  return MOUNT.test(mount) || mount === UNFILED_ARTIFACT_MOUNT ? `${mount}/${docId}` : null;
}

/** The parts of an artifact ref, or `null`. */
export function parseArtifactRef(ref: string): { mount: string; docId: string; projectId: string } | null {
  const i = ref.indexOf('/');
  if (i <= 0) return null;
  const mount = ref.slice(0, i);
  const docId = ref.slice(i + 1);
  if (!DOC.test(docId) || !(mount === UNFILED_ARTIFACT_MOUNT || MOUNT.test(mount))) return null;
  return { mount, docId, projectId: mount === UNFILED_ARTIFACT_MOUNT ? 'default' : mount };
}

/** Whether a selected part's id is one crew takes. */
export function isAnchorWid(wid: string): boolean {
  return WID.test(wid);
}

// ── Chat proposals (api-types 0.170.0, DES-CHAT-ARTIFACTS-001 §4, slice A2) ─────────────────────────────────────────

export type ArtifactProposalKind = 'create' | 'refine' | 'theme' | 'demo';

/** One "From" chip, as crew resolved and authorized it. */
export interface ProposalSource {
  token: string;
  label: string;
  /** `struck`: the draft never sees it; `reason` says why. */
  status: 'ok' | 'struck';
  reason?: string;
  projectId?: string | null;
}

export interface ProposalHelpers { seats: string[]; label: string }

export interface ProposalTime {
  minutes: [number, number] | null;
  cost: 'low' | 'medium' | 'high' | null;
  steps: number | null;
  median: { runs: number; minutes: number; costUsd: number | null; costRuns: number } | null;
  label: string;
}

/** A proposal as crew resolved it: every line is crew's. */
export interface ArtifactProposal {
  pid: string;
  chatId: string;
  turnId: string | null;
  sourceRunId?: string;
  kind: ArtifactProposalKind;
  seat: string;
  what: { entry: string | null; title: string; label: string; outcome: string | null };
  brief: string | null;
  reason: string | null;
  sources: ProposalSource[];
  repos: string[];
  /** (api-types 0.171.0) The same repositories by registry id, in the same order. */
  repoRefs?: string[];
  /** (api-types 0.171.0) A crew-made retry (`sourceRunId`): the document it fills again. */
  artifactRef?: string;
  helpers: ProposalHelpers | null;
  time: ProposalTime | null;
  stops: string | null;
  filedIn: { projectId: string | null; label: string };
  target?: { ref: string; title: string; base: number };
  touches?: string[];
  theme?: { name: string; patch: Record<string, string | number | boolean>; changes: string[] };
  demo?: { url: string; audience: string | null; show: string | null };
  /** Go is refused with this reason; `null` = Go is open. */
  blocked: string | null;
}

export interface ProposalEdits {
  title?: string; brief?: string; sources?: string[]; repos?: string[]; project?: string | null;
  ask?: string; allow?: string[];
  name?: string; patch?: Record<string, string | number | boolean>;
  url?: string; audience?: string; show?: string;
  helpers?: string[];
}

export interface ProposalIdentity { artifactRef: string | null; runId: string }

export interface ProposalResult { runId: string; artifactRef: string | null; adopted: boolean; stub: boolean }

/** A proposal folded from its records. */
export interface ChatProposalView {
  proposal: ArtifactProposal;
  state: 'open' | 'accepting' | 'decided' | 'superseded';
  decision?: 'go' | 'not_now';
  result?: ProposalResult | null;
  decidedAt?: number;
}

/** The transcript records a proposal is made of (`GET /chats/:id` / `GET /chats/:id/messages`). */
export type ChatProposalRecord =
  | { at: number; turnId: string; kind: 'proposal'; proposal: ArtifactProposal }
  | { at: number; turnId: string; kind: 'proposal_accepting'; pid: string; actor: string; edits: ProposalEdits | null; resolution: ArtifactProposal; identity: ProposalIdentity }
  | { at: number; turnId: string; kind: 'proposal_decided'; pid: string; actor: string; decision: 'go' | 'not_now'; result: ProposalResult | null };

/** `POST /chats/:id/proposals/:pid` body. (api-types 0.196.0) `power`: a job Start's choice, sent only where crew
 *  advertises `chatJobPower` and the proposal says `powerChoice` (true = a power run, false = it stops at its plan). */
export interface ChatProposalDecisionBody { decision: 'go' | 'not_now'; edits?: ProposalEdits; power?: boolean }

/** `POST /chats/:id/proposals/:pid` → 200 (and the `view` a 409 carries). */
export interface ChatProposalDecisionResponse { view: ChatProposalView }

/** `/ws`: a proposal record was appended to chat `chat`. */
export interface ChatProposalFrame { type: 'chatProposal'; chat: string; turn_id: string; record: ChatProposalRecord; project_id?: string }
