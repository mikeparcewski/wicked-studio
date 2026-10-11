import { useEffect, useState } from 'react';

/** The app's ONE breakpoint (design/UI-CONTRACT.md §2): phone = max-width 767px. */
export const PHONE_QUERY = '(max-width: 767px)';

function matches(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/** True while the viewport is phone-width; follows resizes. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const on = (): void => setPhone(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}
