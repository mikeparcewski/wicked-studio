import type { ArtifactProposal, ProposalInputValue, ProposalRevisionEdits, ProposalSource, ProposalToken } from '../api/types.js';

/**
 * The listbox a `documents` or `sources` job-input token opens (DES-CATALOG-002 CS12). Crew sends the two tokens on a
 * job proposal's sentence and carries the current pick in `proposal.inputs`; a person's pick is one revision that
 * replaces the whole list. Pure, and read defensively: the pinned `wicked-crew-api-types` (0.196.0) does NOT carry these
 * fields, so a daemon that predates them sends none and the token stays a plain fact exactly as today (the reader
 * returns `null`).
 *
 * slice P (board) writes this; slice Q (the passage) imports it.
 */

// ── The local extension types (the CS12 fields the pinned types lack) ────────────────────────────────────────────────

/** One source option on a `sources` token. `reason` present = it can't be picked (and why); `picked` = in the job now. */
export interface JobSourceOption { id: string; label: string; picked: boolean; reason?: string }

/** The `documents` token crew puts on a job proposal's sentence: each document is `ok` or `struck` with a reason. */
export interface DocumentsToken extends Omit<ProposalToken, 'kind'> { kind: 'documents'; documents: ProposalSource[] }

/** The `sources` token crew puts on a job proposal's sentence. */
export interface SourcesToken extends Omit<ProposalToken, 'kind'> { kind: 'sources'; sources: JobSourceOption[] }

/** The `inputs.documents` arm of `ProposalInputValue` (a revision's new document list). */
export interface DocumentsInputValue { kind: 'documents'; tokens: string[] }

/** The `inputs.sources` arm of `ProposalInputValue` (a revision's new source pick). */
export interface SourcesInputValue { kind: 'sources'; ids: string[] }

/** `ProposalInputValue` widened with the documents/sources arms the pinned types do not have yet. */
export type JobInputValue = ProposalInputValue | DocumentsInputValue | SourcesInputValue;

// ── The contract (slice Q imports these) ─────────────────────────────────────────────────────────────────────────────

/** One pick in the listbox = one revision. */
export interface InputTokenChoice { label: string; edit: ProposalRevisionEdits }

/** A document or source that is shown but can't be picked, and why. */
export interface InputTokenUnavailable { label: string; reason: string }

// ── Defensive readers ────────────────────────────────────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === 'string';

/** The token's `documents` list, or `null` if absent or any entry is malformed (the token stays a plain fact). */
function documentsOf(token: ProposalToken): ProposalSource[] | null {
  const raw = (token as unknown as { documents?: unknown }).documents;
  if (!Array.isArray(raw)) return null;
  const out: ProposalSource[] = [];
  for (const d of raw) {
    if (!isObj(d) || !str(d['token']) || !str(d['label'])) return null;
    if (d['status'] !== 'ok' && d['status'] !== 'struck') return null;
    if (d['reason'] !== undefined && !str(d['reason'])) return null;
    out.push({ token: d['token'], label: d['label'], status: d['status'], ...(str(d['reason']) ? { reason: d['reason'] } : {}) });
  }
  return out;
}

/** The token's `sources` list, or `null` if absent or any entry is malformed. */
function sourcesOf(token: ProposalToken): JobSourceOption[] | null {
  const raw = (token as unknown as { sources?: unknown }).sources;
  if (!Array.isArray(raw)) return null;
  const out: JobSourceOption[] = [];
  for (const s of raw) {
    if (!isObj(s) || !str(s['id']) || !str(s['label']) || typeof s['picked'] !== 'boolean') return null;
    if (s['reason'] !== undefined && !str(s['reason'])) return null;
    out.push({ id: s['id'], label: s['label'], picked: s['picked'], ...(str(s['reason']) ? { reason: s['reason'] } : {}) });
  }
  return out;
}

/** A `proposal.inputs` arm, read defensively (the field is not on the pinned type). */
function inputValueOf(proposal: ArtifactProposal, id: string): Record<string, unknown> | null {
  const inputs = (proposal as unknown as { inputs?: unknown }).inputs;
  if (!isObj(inputs)) return null;
  const v = inputs[id];
  return isObj(v) ? v : null;
}

/** The current source pick carried in `proposal.inputs.sources`, or `null`. */
function inputSourceIds(proposal: ArtifactProposal): string[] | null {
  const v = inputValueOf(proposal, 'sources');
  if (v === null || v['kind'] !== 'sources') return null;
  const ids = v['ids'];
  return Array.isArray(ids) && ids.every(str) ? ids : null;
}

// The two input values the pinned `ProposalInputValue` union does not have yet: crew understands them on the wire, so
// the revision carries the real arm, cast once here while the pin lags the release.
const docsEdit = (tokens: string[]): ProposalRevisionEdits => ({ inputs: { documents: { kind: 'documents', tokens } as unknown as ProposalInputValue } });
const sourcesEdit = (ids: string[]): ProposalRevisionEdits => ({ inputs: { sources: { kind: 'sources', ids } as unknown as ProposalInputValue } });

// ── The listbox ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The listbox a `documents` or `sources` token opens, built from the token's own list and the proposal's inputs.
 * `null` = not an input token, or crew sent no list (the token stays a plain fact).
 *
 * documents: one choice per ok document — `Leave out <label>` replaces the whole document list with the current one
 * minus it (leaving out the last is allowed: crew then asks for documents). Each struck document is shown, never
 * selectable. No "add": new files come in through the composer's attach.
 *
 * sources: one choice per pickable source — `Add <label>` (not picked) or `Leave out <label>` (picked) replaces the
 * whole pick with the new one, in the token's own order. Each unpickable source (one with a reason) is shown, never
 * selectable.
 */
export function inputTokenChoices(token: ProposalToken, proposal: ArtifactProposal):
{ choices: InputTokenChoice[]; unavailable: InputTokenUnavailable[] } | null {
  const kind: string = token.kind;
  if (kind === 'documents') {
    const docs = documentsOf(token);
    if (docs === null) return null;
    const ok = docs.filter((d) => d.status === 'ok');
    // The documents that stay are the usable ones: crew refuses an edit that names a struck token, so a struck document
    // is never sent back (it drops out with the first change the person makes).
    const current = ok.map((d) => d.token);
    const choices: InputTokenChoice[] = ok.map((d) => ({
      label: `Leave out ${d.label}`,
      edit: docsEdit(current.filter((t) => t !== d.token)),
    }));
    const unavailable: InputTokenUnavailable[] = docs.filter((d) => d.status === 'struck').map((d) => ({ label: d.label, reason: d.reason ?? '' }));
    return { choices, unavailable };
  }
  if (kind === 'sources') {
    const sources = sourcesOf(token);
    if (sources === null) return null;
    const ids = inputSourceIds(proposal);
    const isPicked = (s: JobSourceOption): boolean => (ids !== null ? ids.includes(s.id) : s.picked);
    const pickable = sources.filter((s) => s.reason === undefined);
    // The new pick walks the token's own order, so a pick keeps it (§CS12 "order kept").
    const newPick = (toggled: JobSourceOption): string[] =>
      pickable.filter((s) => (s.id === toggled.id ? !isPicked(toggled) : isPicked(s))).map((s) => s.id);
    const choices: InputTokenChoice[] = pickable.map((s) => ({
      label: `${isPicked(s) ? 'Leave out' : 'Add'} ${s.label}`,
      edit: sourcesEdit(newPick(s)),
    }));
    const unavailable: InputTokenUnavailable[] = sources.filter((s) => s.reason !== undefined).map((s) => ({ label: s.label, reason: s.reason! }));
    return { choices, unavailable };
  }
  return null;
}
