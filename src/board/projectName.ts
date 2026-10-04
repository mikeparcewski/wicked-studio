/**
 * THE project-name rule (studio#463), the daemon's: crew's `POST /projects` takes
 * `name: z.string().min(1).max(120)` and answers 409 on an active-name collision. Every creation
 * path (the Projects page's inline form, the New project modal) checks the same thing, so a name the
 * operator already sees in the switcher ("Team offsite", "Recipe cards") can be typed anywhere.
 * The name is sent trimmed; a collision is the daemon's to say.
 */
export const PROJECT_NAME_MAX = 120;

/** Why `name` cannot be sent, in plain words — `null` when it can (after trimming). */
export function projectNameProblem(name: string): string | null {
  const t = name.trim();
  if (t === '') return 'A project needs a name.';
  if ([...t].length > PROJECT_NAME_MAX) return `Keep the name to ${PROJECT_NAME_MAX} characters.`;
  return null;
}
