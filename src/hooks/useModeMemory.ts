import { useCallback, useRef } from 'react';
import type { Mode } from './useRoute.js';

/**
 * The project shell's per-mode artifact memory (DES-MERGE-001 §1.3 rule 1): Build → Chat →
 * Build lands back on the same run. The memory is PROJECT-SCOPED — keyed by project id — so
 * after a switch to another project a mode never reopens the previous project's artifact
 * (studio wave 1: the shell outlives the switch, and the old flat memory leaked a1 into
 * beta's Build tab). Returning to the first project still finds its artifacts.
 *
 * Returns the lookup: what `mode` last showed in `projectId`, or null.
 */
export function useModeMemory(
  projectId: string,
  mode: Mode,
  artifactId: string | null,
): (next: Mode) => string | null {
  // A ref, not state: remembering never drives a render.
  const memory = useRef<Record<string, Partial<Record<Mode, string>>>>({});
  if (artifactId) (memory.current[projectId] ??= {})[mode] = artifactId;
  return useCallback((next: Mode) => memory.current[projectId]?.[next] ?? null, [projectId]);
}
