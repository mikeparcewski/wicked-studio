/**
 * The one formatter for paths the daemon reports (studio#458, #460, #462 — the rule studio#444 set
 * for the hand-over card): in the DEFAULT layer, an absolute path under the operator's home
 * directory reads as `~/…`. A screen share or a recording then never prints the account name and
 * the local folder layout; "Show technical details" (`useViewPrefsStore`) shows the full path.
 *
 * Studio is a browser client and is never told the daemon host's home directory, so the three
 * desktop spellings are recognised by shape: `/Users/<name>` (macOS), `/home/<name>` and `/root`
 * (Linux), `<drive>:\Users\<name>` (Windows, either slash, any case). Anything else (`/tmp/…`,
 * `/var/…`, a repo-relative `src/App.tsx`, an already-abbreviated `~/…`) is left exactly as it is.
 *
 * `<name>` is an account's short name: dot-separated words with no slash, whitespace, quote,
 * bracket or `,;:` — so prose punctuation after a bare home directory ("in /home/alice, then")
 * stays outside the match. Known limit: a Windows account name with a space in it is not
 * recognised (one word is).
 *
 * Pure functions; the hooks in `hooks/useHomePath.ts` bind them to the technical-details pref.
 */

/** One word of an account name: no separator, whitespace, quote, bracket or prose punctuation. */
const WORD = String.raw`[^\/\\\s"'\`()\[\]<>,;:.]+`;
/** A Windows account name may hold an apostrophe (O'Neil); a POSIX one never does. */
const WIN_WORD = String.raw`[^\/\\\s"\`()\[\]<>,;:.]+`;
/** The three spellings of a home directory, at the start of a path. */
const HOME_HEAD =
  String.raw`(?:\/Users\/${WORD}(?:\.${WORD})*|\/home\/${WORD}(?:\.${WORD})*|\/root|[A-Za-z]:[\\\/][Uu]sers[\\\/]${WIN_WORD}(?:\.${WIN_WORD})*)`;

/** A path field: the home directory is the whole path, or is followed by a separator. */
const PATH_RE = new RegExp(String.raw`^${HOME_HEAD}(?=$|[\\\/])`);
/** In prose: starts at the text's start or after a character no path contains, and ends at the
 *  text's end, a separator, whitespace or prose punctuation (which stays in the text). */
const TEXT_RE = new RegExp(String.raw`(^|[^A-Za-z0-9_.~\\\/-])${HOME_HEAD}(?=$|[\\\/\s"'\`()\[\]<>,;:.])`, 'g');

/** One path as the daemon reports it → its display form (`~/…` when it is under a home directory). */
export function displayPath(path: string): string {
  return path.replace(PATH_RE, '~');
}

/** Free text (a unit's output, a finding's message, a deliver card) with every home path → `~/…`. */
export function displayText(text: string): string {
  return text.replace(TEXT_RE, '$1~');
}
