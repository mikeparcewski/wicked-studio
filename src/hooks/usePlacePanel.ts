import { useEffect, useRef } from 'react';
import { registerPlacePanel } from '../store/place.js';

/**
 * Opt a panel's open state into "where you were" (studio wave 2a, behaviour 3): a jump
 * captures `value`, and the Back key hands it back through `set` — even when the owner
 * remounts after the route change. `value` must be plain data (it is held, not cloned).
 */
export function usePlacePanel<T>(key: string, value: T, set: (v: T) => void): void {
  const ref = useRef({ value, set });
  ref.current = { value, set };
  useEffect(
    () =>
      registerPlacePanel(key, {
        get: () => ref.current.value,
        set: (v) => ref.current.set(v as T),
      }),
    [key],
  );
}
