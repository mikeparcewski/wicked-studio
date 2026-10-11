/**
 * Relative time in words (design/UI-CONTRACT.md §4.0; UX audit row 35: no raw "9/13/2026, 12:13:18 PM").
 * `relTime` is the words a list row shows; `absTime` goes in its `title`. Pure.
 */
export function relTime(at: number, now: number = Date.now()): string {
  const secs = Math.round((now - at) / 1000);
  if (!Number.isFinite(secs)) return 'time unknown';
  if (secs < 0) return 'just now';
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return mins === 1 ? '1 minute ago' : `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (days < 30) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  if (days < 365) return months <= 1 ? '1 month ago' : `${months} months ago`;
  const years = Math.round(days / 365);
  return years === 1 ? '1 year ago' : `${years} years ago`;
}

/** The absolute time for a `title` attribute. */
export function absTime(at: number): string {
  return new Date(at).toLocaleString();
}
