import { useCallback, useState } from 'react';

/**
 * Which rail groups this viewer folded (studio-rail-clean). Kept in this browser's localStorage, so a
 * folded project stays folded across reloads for whoever folded it; nothing goes to the daemon. A
 * group's key is its project id, or `''` for "Not in a project". Storage that is unavailable (private
 * mode, quota, a blocked origin) or holds something unreadable means "nothing folded": the rail
 * never fails over it.
 */
export const RAIL_COLLAPSED_KEY = 'studio.rail.collapsed';

export function readRailCollapsed(): Set<string> {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(RAIL_COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeRailCollapsed(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify([...keys]));
  } catch {
    // Not saved: the fold still holds for this page's life.
  }
}

export function useRailCollapsed(): { collapsed: ReadonlySet<string>; toggle: (key: string) => void } {
  const [collapsed, setCollapsed] = useState<Set<string>>(readRailCollapsed);
  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      writeRailCollapsed(next);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
