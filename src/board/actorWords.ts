/**
 * An actor id in a person's words (operator 2026-10-29: never "local" as an actor). crew records the local operator
 * as `local` (or `local (human)` on a receipt): that is "you". Another person's id is said as it is, without the
 * "(human)" suffix; anything else is left as recorded.
 */
export function actorWords(by: string): string {
  const id = by.trim().replace(/\s*\(human\)$/i, '');
  if (id === '' || id === 'local' || id === 'operator' || id === 'human:local') return 'you';
  return id;
}
