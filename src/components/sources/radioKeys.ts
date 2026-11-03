/** A radio group's keys (WAI-ARIA radio group): arrows move and select, Home and End jump. `null` = not ours. */
export function radioKey(key: string, index: number, count: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Focus the group's radio at `index` (the one just selected). */
export function focusRadio(from: HTMLElement, index: number): void {
  from.closest('[role="radiogroup"]')?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus();
}
