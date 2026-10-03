import type { AboutChip } from './aboutChips.js';
import { QUOTE_MAX } from './aboutChips.js';

/**
 * S8 — the morphing artifact and the page element editor (DES-STUDIO-REBUILD-001 §11 S8;
 * DESIGN-interaction rules 1 "the object is the control" and 3 "edit by touching"). Pure model:
 * the morph steps, the picked element as a composer chip, and the lines under a touch edit.
 *
 * The three sizes are the plugin protocol's (`editors/protocol.ts` `Size`): the inline preview in
 * the thread, the pane beside it, and full screen — one element that changes size, never
 * re-parented (DOC-1 / EP-D2).
 */
export type ArtifactSize = 'inline' | 'pane' | 'full';

/** A click on the preview, or ⤢: one step larger. */
export function grow(size: ArtifactSize): ArtifactSize {
  return size === 'inline' ? 'pane' : 'full';
}

/** Esc: one step smaller. */
export function shrink(size: ArtifactSize): ArtifactSize {
  return size === 'full' ? 'pane' : 'inline';
}

/** The picked element as the subject of the next message — "about: “…”" (rule 2), keyed by its
 *  anchor so picking the same element twice makes one chip. */
export function elementChip(wid: string, text: string, docId = ''): AboutChip {
  const key = docId === '' ? `el:${wid}` : `el:${docId}/${wid}`;
  const t = text.replace(/\s+/g, ' ').trim();
  if (t === '') return { kind: 'about', key, label: wid };
  const cut = t.length > QUOTE_MAX ? `${t.slice(0, QUOTE_MAX).trimEnd()}…` : t;
  return { kind: 'about', key, label: `“${cut}”` };
}

/** Under the page after a touch edit landed: the version it made. The Undo sits beside it. */
export function editedLine(version: number, wid: string): string {
  return `Changed ${wid} — version ${version}.`;
}

/** Undo forked the page before the change as a new head. */
export function undoneLine(version: number): string {
  return `Undone — version ${version} is the page before your change.`;
}

/** Undo refused (`409 head_moved`): a helper's version landed in between, and burying it would
 *  lose their work — so the operator's change stays and the line says why. */
export function notUndoneLine(head: number): string {
  return `Not undone — a helper changed the page since (version ${head}). Your change stays; undo by hand if you still want it.`;
}
