import { create } from 'zustand';

/**
 * Shared ownership of an element's `inert` (codex r5 on the container sign-in): the agent's modal and the
 * login window over it both hold the app root inert, and it is released only when the LAST holder lets go.
 * An element already inert for some other reason is left to whoever made it so.
 */
const holds = new WeakMap<Element, number>();

export function holdInert(el: Element | null): () => void {
  if (el === null) return () => {};
  const n = holds.get(el) ?? 0;
  if (n === 0 && el.hasAttribute('inert')) return () => {};
  holds.set(el, n + 1);
  el.setAttribute('inert', '');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (holds.get(el) ?? 1) - 1;
    holds.set(el, left);
    if (left === 0) el.removeAttribute('inert');
  };
}

/**
 * The container login window is open (codex r6): an agent modal that mounts beneath it meanwhile (Back, then
 * Forward) stays inert and leaves focus where it is, since the login window is the one on top.
 */
export const useLoginCover = create<{ open: boolean; returnTo: HTMLElement | null; set: (open: boolean, returnTo?: HTMLElement | null) => void }>((set) => ({
  open: false,
  /** Where focus was when the login window opened (the modal beneath restores it once it is not inert). */
  returnTo: null,
  set: (open, returnTo = null) => set({ open, returnTo }),
}));
