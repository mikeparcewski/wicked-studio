import { create } from 'zustand';
import { addChip, backspaceChips, removeChip, type AboutChip } from '../board/aboutChips.js';

/**
 * The about-chips on each composer (S7), keyed by composer: `desk`, or a session id. Any surface
 * can make something the subject of the next message — a text selection in the thread, `@`, and
 * (S8) an element picked on a page — by {@link addAboutChip}; the composer renders and spends them.
 */
interface ComposerChipsStore {
  byComposer: Record<string, AboutChip[]>;
}

export const useComposerChips = create<ComposerChipsStore>(() => ({ byComposer: {} }));

const EMPTY: AboutChip[] = [];

export function chipsOf(s: ComposerChipsStore, key: string): AboutChip[] {
  return s.byComposer[key] ?? EMPTY;
}

function put(key: string, chips: AboutChip[]): void {
  useComposerChips.setState((s) => ({ byComposer: { ...s.byComposer, [key]: chips } }));
}

export function addAboutChip(key: string, chip: AboutChip): void {
  put(key, addChip(chipsOf(useComposerChips.getState(), key), chip));
}

/** A subject that is already on the composer takes its words as they read now (the element was
 *  changed since it was picked). A subject that is not there is NOT added — a chip the operator
 *  removed stays removed. */
export function relabelAboutChip(key: string, chip: AboutChip): void {
  const chips = chipsOf(useComposerChips.getState(), key);
  const at = chips.findIndex((c) => c.kind === 'about' && c.key === chip.key);
  if (at === -1 || chips[at]?.label === chip.label) return;
  put(key, chips.map((c, i) => (i === at ? chip : c)));
}

export function removeAboutChip(key: string, chipKey: string): void {
  put(key, removeChip(chipsOf(useComposerChips.getState(), key), chipKey));
}

/** Backspace in the box: true when it removed a chip (the box was empty). */
export function backspaceAboutChip(key: string, text: string): boolean {
  const next = backspaceChips(chipsOf(useComposerChips.getState(), key), text);
  if (next === null) return false;
  put(key, next);
  return true;
}

export function clearAboutChips(key: string): void {
  put(key, []);
}
