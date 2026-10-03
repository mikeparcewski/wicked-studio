/**
 * The one formatter for paths the daemon reports (studio#458, #460, #462 — the rule studio#444 set
 * for the hand-over card): in the DEFAULT layer, an absolute path under the operator's home
 * directory reads as `~/…`. A screen share or a recording then never prints the account name and
 * the local folder layout; "Show technical details" (`useViewPrefsStore`) shows the full path.
 *
 * Studio is a browser client and is never told the daemon host's home directory, so the three
 * desktop spellings are recognised by shape: `/Users/<name>` (macOS), `/home/<name>` and `/root`
 * (Linux), `<drive>:\Users\<name>` (Windows, either slash). Anything else (`/tmp/…`, `/var/…`, a
 * repo-relative `src/App.tsx`, an already-abbreviated `~/…`) is left exactly as it is.
 *
 * Pure functions; the hooks in `hooks/useHomePath.ts` bind them to the technical-details pref.
 */

/** A home directory, at the start of a path. `<name>` is one segment: no slash, no whitespace. */
const HOME_HEAD = String.raw`(?:\/Users\/[^\/\\\s"'\`()\[\]<>]+|\/home\/[^\/\\\s"'\`()\[\]<>]+|\/root|[A-Za-z]:[\\\/]Users[\\\/][^\/\\\s"'\`()\[\]<>]+)`;
/** What may follow the home directory for it to be the directory itself: the end, or a separator. */
const HOME_TAIL = String.raw`(?=$|[\\\/\s"'\`()\[\]<>,;:])`;

const PATH_RE = new RegExp(`^${HOME_HEAD}${HOME_TAIL}`);
/** In prose: the path must start at the text's start or after a character no path contains. */
const TEXT_RE = new RegExp(String.raw`(^|[^A-Za-z0-9_.~\\\/-])${HOME_HEAD}${HOME_TAIL}`, 'g');

/** One path as the daemon reports it → its display form (`~/…` when it is under a home directory). */
export function displayPath(path: string): string {
  return path.replace(PATH_RE, '~');
}

/** Free text (a unit's output, a finding's message, a deliver card) with every home path → `~/…`. */
export function displayText(text: string): string {
  return text.replace(TEXT_RE, '$1~');
}

/** Whether the text still carries a home path — what the desk journey asserts is never rendered. */
export function hasHomePath(text: string): boolean {
  TEXT_RE.lastIndex = 0;
  return TEXT_RE.test(text);
}
