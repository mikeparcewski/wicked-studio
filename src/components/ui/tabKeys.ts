import type { KeyboardEvent } from 'react';

/** Move through this tablist and activate through the tab's existing click handler. */
export function handleTabKeyDown(event: KeyboardEvent<HTMLElement>): HTMLElement | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return null;
  const tabs = Array.from(event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []);
  const index = tabs.indexOf(event.currentTarget);
  if (index < 0) return null;
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  const target = tabs[next]!;
  target.focus();
  target.click();
  return target;
}
