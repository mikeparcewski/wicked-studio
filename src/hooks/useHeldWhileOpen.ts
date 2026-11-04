import { useRef } from 'react';

/**
 * A value that holds still while `open` (slash-catalog, codex r1): the `/` menu's rows do not reorder
 * under the active row when the catalog's refresh lands mid-pick (a refreshed "Your top"), so Enter
 * starts the row that was highlighted. The first value that arrives while open is the one shown (a
 * cold read lands once); closing lets go, and the next open shows the newest.
 */
export function useHeldWhileOpen<T>(value: T | null, open: boolean): T | null {
  const held = useRef<T | null>(null);
  if (!open) held.current = null;
  else if (held.current === null) held.current = value;
  return open ? held.current : value;
}
