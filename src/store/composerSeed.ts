import { create } from 'zustand';

/**
 * THE COMPOSER SEED (S19b, DES-STUDIO-REBUILD-001 §5.5): words a command puts in a composer — ⌘K
 * "New Build" puts `/workflow-` in one, focused, so the `/` menu opens. Nothing is ever sent.
 *
 * One pending seed, addressed to one composer by its key (`desk`, or a session id). The composer of
 * that key TAKES it exactly once (the seed is cleared as it lands), so a re-render, a remount or a
 * second composer never applies it twice. It is separate from type-to-composer
 * (`useTypeToComposer`): that hook moves typed letters into whichever box is on the page; a seed only
 * lands in the composer it names, and only when a command wrote it.
 */
export interface ComposerSeed {
  /** The composer that takes it: `desk`, or a session id. */
  composerKey: string;
  text: string;
}

interface ComposerSeedStore {
  seed: ComposerSeed | null;
}

export const useComposerSeed = create<ComposerSeedStore>(() => ({ seed: null }));

/** Leave words for a composer; the composer of that key takes them on its next render. */
export function seedComposer(composerKey: string, text: string): void {
  useComposerSeed.setState({ seed: { composerKey, text } });
}

/** The pending seed for this composer, cleared as it is taken; null when there is none for it. */
export function takeComposerSeed(composerKey: string): string | null {
  const s = useComposerSeed.getState().seed;
  if (s === null || s.composerKey !== composerKey) return null;
  useComposerSeed.setState({ seed: null });
  return s.text;
}

/**
 * The composer a command should seed right now: the one on the page that is shown (a session's), else
 * null — the Desk's composer is then the place (the caller navigates there first). The Ask dock is a
 * different box (`data-type-target="ask"`, not a `composer`) and is never a seed target.
 */
export function pageComposerKey(doc: Document = document): string | null {
  for (const el of doc.querySelectorAll<HTMLElement>('[data-testid="composer"][data-composer]')) {
    if (!el.isConnected || el.closest('[hidden],[inert],[aria-hidden="true"]') !== null) continue;
    const key = el.dataset.composer;
    if (key !== undefined && key !== '') return key;
  }
  return null;
}
