/**
 * The chat-artifacts wire, slice A1 (DES-CHAT-ARTIFACTS-001 §5.1, §6.3, §14; `wicked-crew-api-types` 0.169.0). A
 * VERBATIM mirror of the contract block while studio's pin lags the release: when the pin moves, these become
 * re-exports from the package and this mirror goes. Gated by `GET /health.capabilities.chatArtifacts.context`: an
 * older daemon's message body is strict, so it is never sent any of it.
 */

/** `GET /health.capabilities.chatArtifacts` (api-types 0.169.0): one flag per operation. */
export interface ChatArtifactsCapabilities {
  context: boolean;
  proposals: boolean;
  create: boolean;
  refine: boolean;
  theme: boolean;
  demo: boolean;
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
