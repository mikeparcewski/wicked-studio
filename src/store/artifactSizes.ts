import { create } from 'zustand';
import type { ArtifactSize } from '../board/artifactMorph.js';

/**
 * How large each artifact is right now (S8): `inline` in the thread, `pane` beside it, `full`
 * screen — keyed by `<runId>:<projectId>/<docId>`, so a morph survives the thread re-rendering. Leaving a
 * session collapses its open artifacts ({@link collapseArtifacts}): a pane remembered from another
 * session must not narrow this one.
 */
interface ArtifactSizesStore {
  sizes: Record<string, ArtifactSize>;
}

export const useArtifactSizes = create<ArtifactSizesStore>(() => ({ sizes: {} }));

/** One size per artifact INSTANCE: two run blocks bound to the same document are two previews, and
 *  the one that was clicked is the one that grows. */
export function artifactKey(projectId: string, docId: string, runId: string): string {
  return `${runId}:${projectId}/${docId}`;
}

export function artifactSizeOf(s: ArtifactSizesStore, key: string): ArtifactSize {
  return s.sizes[key] ?? 'inline';
}

/** Sets the size. ONE artifact is open at a time: growing one folds every other back to inline, so
 *  what is drawn on top and what Esc shrinks are the same thing ({@link topmostArtifact}). */
export function setArtifactSize(key: string, size: ArtifactSize): void {
  useArtifactSizes.setState((s) => {
    if (size !== 'inline') return { sizes: { [key]: size } };
    return { sizes: Object.fromEntries(Object.entries(s.sizes).filter(([k]) => k !== key)) };
  });
}

/** Whether any artifact is open as a pane — the session gives it room beside the thread. */
export function paneOpen(s: ArtifactSizesStore): boolean {
  return Object.values(s.sizes).includes('pane');
}

/** The one artifact Esc shrinks — the one open (pane or full). `null` = none open. */
export function topmostArtifact(s: ArtifactSizesStore): string | null {
  return Object.entries(s.sizes).find(([, size]) => size !== 'inline')?.[0] ?? null;
}

/** Back to inline, every one of them — when the session is left. */
export function collapseArtifacts(): void {
  useArtifactSizes.setState({ sizes: {} });
}

/** Test seam. */
export function resetArtifactSizes(): void {
  useArtifactSizes.setState({ sizes: {} });
}

/** S16a-4a: which artifacts are on the page right now (an ArtifactMorph registers while mounted), so
 *  an address naming a key the session does not hold grows nothing and says so. */
export const useMountedArtifacts = create<{ keys: Record<string, number> }>(() => ({ keys: {} }));

export function registerArtifact(key: string): () => void {
  useMountedArtifacts.setState((s) => ({ keys: { ...s.keys, [key]: (s.keys[key] ?? 0) + 1 } }));
  return () => useMountedArtifacts.setState((s) => {
    const n = (s.keys[key] ?? 1) - 1;
    const keys = { ...s.keys };
    if (n <= 0) delete keys[key]; else keys[key] = n;
    return { keys };
  });
}
