import type { Chip } from '../../editors/model.js';
import type { ArtifactBinding } from '../../editors/hostApi.js';
import { focusBeside } from '../../editors/focus.js';
import { addAboutChip } from '../../store/composerChips.js';
import { useSessionDrafts } from '../../store/sessionDrafts.js';

/**
 * What every plugin instance (card, full screen, options) hands the session composer, in the host's words:
 * "about:" chips for the elements and chapters the host resolved, the one typed character with the focus, and the
 * forwarded chords (Tab out of the frame, Mod+K, Alt chords). One path, so the options panel behaves like the card
 * (ev2-ports codex h4b-r2).
 */

export function focusComposer(composerKey: string): void {
  const el = document.querySelector<HTMLTextAreaElement>(`[data-testid="composer"][data-composer="${composerKey}"] textarea`);
  if (el === null) return;
  el.focus();
  requestAnimationFrame(() => { const n = el.value.length; el.setSelectionRange(n, n); });
}

function pressInHost(init: KeyboardEventInit): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

/** Elements and chapters become chips; the label is the host's own (the host resolved it from its inventory). */
export function chipsToComposer(b: ArtifactBinding, chips: readonly Chip[]): void {
  const doc = b.docId ?? b.artifactKey;
  for (const c of chips) {
    if (c.anchor.kind === 'element') addAboutChip(b.composerKey, { kind: 'about', key: `el:${doc}/${c.anchor.id}`, label: c.label });
    else if (c.anchor.kind === 'chapter') addAboutChip(b.composerKey, { kind: 'about', key: `ch:${doc}/${c.anchor.id}`, label: c.label });
  }
}

export function typedToComposer(composerKey: string, grapheme: string): void {
  const s = useSessionDrafts.getState();
  s.setDraft(composerKey, `${s.drafts[composerKey] ?? ''}${grapheme}`);
  focusComposer(composerKey);
}

/** The forwarded chords other than Escape (each surface decides what Escape means). */
export function forwardedKey(k: string, frame: HTMLIFrameElement | null): void {
  if (k === 'Mod+K') pressInHost({ key: 'k', code: 'KeyK', metaKey: true, ctrlKey: true });
  else if (k.startsWith('Alt+')) pressInHost({ key: k.slice(4).toLowerCase(), code: `Key${k.slice(4)}`, altKey: true });
  else if (k === 'Tab' || k === 'Shift+Tab') focusBeside(frame, k === 'Shift+Tab');
}
