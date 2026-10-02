import { useEffect, useRef } from 'react';
import { anyModalOpen, useLayerStore } from '../store/layers.js';
import { isShortcutsPaletteOpen, isTypingContext } from './useGlobalShortcuts.js';

/**
 * Type-to-composer (DES-STUDIO-REBUILD-001 §5.6 rule 4, slice S2b): letters always type.
 *
 * A printable key with no modifier, pressed while focus is NOT in an editable and NOT inside
 * a composite control that claims keys (§5.6 rule 2), goes to a composer:
 *
 *   1. the Ask dock's input, when the dock is open;
 *   2. else the page's composer, when one is mounted (chat, launch);
 *   3. else the Ask dock, opened with the text (opening it only reads, AskDock.tsx).
 *
 * A composer opts in with `data-type-target="page"` (or `"ask"` for the dock). A composer
 * whose send answers a gate (the gate card's steer box) never opts in: typing never answers
 * a question (§10). Nothing here sends anything — the text lands in a box, and only the
 * operator's own Enter / Send in that box sends it.
 *
 * Space never starts a redirect, by design: it presses the focused button or toggles the
 * focused checkbox (native activation the operator relies on), and a leading space means
 * nothing to a composer. Once a letter has moved focus into the composer, Space types there
 * natively. Every chord with Ctrl/⌘/Alt belongs to the shortcut registry.
 */

/** Roles whose focused control owns its own keys (ARIA composite patterns, §5.6 rule 2). */
const COMPOSITE_ROLES = [
  'radiogroup', 'radio', 'listbox', 'option', 'grid', 'gridcell', 'treegrid', 'tree', 'treeitem',
  'menu', 'menubar', 'menuitem', 'menuitemradio', 'menuitemcheckbox', 'tablist', 'tab',
  'slider', 'spinbutton', 'combobox',
];
const COMPOSITE_SELECTOR = [
  ...COMPOSITE_ROLES.map((r) => `[role="${r}"]`),
  '[data-claims-keys]',
].join(',');

/** The one printable-key predicate: one character, not Space, no Ctrl/⌘/Alt. Shift is fine
 *  (it is how a capital is typed). An IME composition is never a printable keystroke. */
export function isTypedCharacter(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return false;
  const key = e.key ?? '';
  return [...key].length === 1 && key !== ' ';
}

/** Focus sits inside a composite control that claims its keys (rule 2): it keeps them. */
export function insideClaimingComposite(el: Element | null): boolean {
  return el !== null && el.closest(COMPOSITE_SELECTOR) !== null;
}

type Field = HTMLTextAreaElement | HTMLInputElement;

/** On screen: not inside a hidden/inert/aria-hidden region, and (where the browser can say)
 *  rendered — a composer in a collapsed panel or a leaving route is not the one on the page. */
function shown(el: Field): boolean {
  if (!el.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]') !== null) return false;
  const check = (el as Field & { checkVisibility?: () => boolean }).checkVisibility;
  return check === undefined ? true : check.call(el);
}

function firstShown(doc: Document, kind: 'ask' | 'page'): Field | null {
  for (const el of doc.querySelectorAll<Field>(`[data-type-target="${kind}"]`)) if (shown(el)) return el;
  return null;
}

/**
 * Where a typed letter goes right now. The open Ask dock outranks the page's composer. While
 * that box is busy (a send in flight disables it) the letter goes NOWHERE — not to another
 * box, and not into a seed for a dock that is already open (nothing would ever take it).
 */
export function typeTarget(doc: Document = document): { into: Field } | 'busy' | null {
  const box = firstShown(doc, 'ask') ?? firstShown(doc, 'page');
  if (box === null) return null;
  return box.disabled || box.readOnly ? 'busy' : { into: box };
}

/** Append `text` at the end of a React-controlled field, focus it, caret at the end.
 *  DOM-first (the native setter, then a real `input` event) so React's onChange sees it. */
export function typeInto(el: HTMLTextAreaElement | HTMLInputElement, text: string): void {
  el.focus({ preventScroll: false });
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter === undefined) return;
  const next = el.value + text;
  setter.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  try {
    el.setSelectionRange(next.length, next.length);
  } catch {
    /* some input types refuse a selection — the text still landed */
  }
}

/** Letters typed while the Ask dock is still mounting: the dock takes them as its first text.
 *  A seed the dock never took (it failed to mount) expires, so it never surfaces later. */
let seed = '';
let seedTimer: ReturnType<typeof setTimeout> | null = null;
const SEED_TTL_MS = 1500;

function addToSeed(ch: string): void {
  seed += ch;
  if (seedTimer !== null) clearTimeout(seedTimer);
  seedTimer = setTimeout(() => { seed = ''; seedTimer = null; }, SEED_TTL_MS);
}

/** The dock calls this once on mount: the letters that opened it (and any typed since). */
export function takeTypedSeed(): string {
  const s = seed;
  seed = '';
  if (seedTimer !== null) { clearTimeout(seedTimer); seedTimer = null; }
  return s;
}

/** Test seam: the pending seed without consuming it. */
export function peekTypedSeed(): string {
  return seed;
}

/** What one keystroke does (pure decision, exported for tests). */
export type TypeAction = { kind: 'none' } | { kind: 'type'; into: HTMLTextAreaElement | HTMLInputElement } | { kind: 'open-ask' };

export function decideTyped(e: KeyboardEvent, doc: Document = document): TypeAction {
  if (e.defaultPrevented || !isTypedCharacter(e)) return { kind: 'none' };
  if (isTypingContext(e)) return { kind: 'none' };
  if (insideClaimingComposite(doc.activeElement)) return { kind: 'none' };
  // A layer that owns the keyboard (palette, modal, the shortcut overlay) keeps it.
  if (isShortcutsPaletteOpen() || anyModalOpen() || useLayerStore.getState().shortcutOverlayOpen) {
    return { kind: 'none' };
  }
  const target = typeTarget(doc);
  if (target === 'busy') return { kind: 'none' };
  return target !== null ? { kind: 'type', into: target.into } : { kind: 'open-ask' };
}

/**
 * Mount once (App). `openAsk` opens the Ask dock; the letters wait in the seed until the
 * dock mounts and takes them (`takeTypedSeed`), so a fast typist loses nothing.
 */
export function useTypeToComposer(openAsk: () => void): void {
  const openRef = useRef(openAsk);
  openRef.current = openAsk;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const action = decideTyped(e);
      if (action.kind === 'none') return;
      e.preventDefault();
      if (action.kind === 'type') {
        typeInto(action.into, e.key);
        return;
      }
      addToSeed(e.key);
      openRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
