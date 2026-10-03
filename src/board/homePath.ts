/**
 * The one formatter for paths the daemon reports (studio#458, #460, #462 — the rule studio#444 set
 * for the hand-over card): in the DEFAULT layer, an absolute path under the operator's home
 * directory reads as `~/…`. A screen share or a recording then never prints the account name and
 * the local folder layout; "Show technical details" (`useViewPrefsStore`) shows the full path.
 *
 * Studio is a browser client and is never told the daemon host's home directory, so the three
 * desktop spellings are recognised by shape: `/Users/<name>` (macOS), `/home/<name>` and `/root`
 * (Linux), `<drive>:\Users\<name>` (Windows, either slash, `Users` in any case). Anything else
 * (`/tmp/…`, `/var/…`, a repo-relative `src/App.tsx`, an already-abbreviated `~/…`) is left exactly
 * as it is.
 *
 * `<name>` is an account's short name: dot-separated words holding no separator, whitespace, quote,
 * bracket or sentence punctuation, so the punctuation after a bare home directory in prose ("in
 * /home/alice, then") stays in the text. A Windows name may also hold apostrophes (O'Neil) and,
 * when a separator follows it, spaces (`C:\Users\Jane Doe\repo`). Known limit: a bare Windows
 * name with a space and nothing after it ("saved under C:\Users\Jane Doe") abbreviates its first
 * word only — prose cannot tell where such a name ends.
 *
 * Pure functions; the hooks in `hooks/useHomePath.ts` bind them to the technical-details pref.
 */

/** One run of name characters: no separator, whitespace, quote, bracket or sentence punctuation. */
const RUN = String.raw`[^\/\\\s"'\`()\[\]<>,;:.!?]+`;
/** A POSIX account name: dot-separated runs (`michael.parcewski`, `ci-runner_2`). */
const NAME = String.raw`${RUN}(?:\.${RUN})*`;
/** A Windows account name: runs joined by dots or apostrophes (`O'Neil`, `jane.doe`). */
const WIN_NAME = String.raw`${RUN}(?:['.]${RUN})*`;
/** A Windows name with spaces, only when a separator follows (so prose after a bare one is safe). */
const WIN_SPACED = String.raw`${WIN_NAME}(?: +${WIN_NAME})+(?=[\\\/])`;
const USERS = String.raw`[Uu][Ss][Ee][Rr][Ss]`;
/** The three spellings of a home directory, at the start of a path. */
const HOME_HEAD =
  String.raw`(?:\/Users\/${NAME}|\/home\/${NAME}|\/root|[A-Za-z]:[\\\/]${USERS}[\\\/](?:${WIN_SPACED}|${WIN_NAME}))`;

/** A path field: the home directory is the whole path, or is followed by a separator. */
const PATH_RE = new RegExp(String.raw`^${HOME_HEAD}(?=$|[\\\/])`);
/** In prose: starts at the text's start or after a prose delimiter — whitespace, a quote, an opening
 *  bracket, `=`, `:` or `,` (an allow-list: any other character, `/tmp/cache!/home/x` included, is
 *  inside a path) — and ends at the text's end, a separator, whitespace, a closing delimiter, or
 *  sentence punctuation that itself ends the token (`/root.backup/repo` is one path; "in
 *  /home/alice, then" keeps its comma). */
const TEXT_RE = new RegExp(String.raw`(^|[\s"'\`(\[<=:,])${HOME_HEAD}(?=$|[\\\/\s"'\`()\[\]<>]|[,;:.!?](?=$|[\s"'\`()\[\]<>]))`, 'g');

/** One path as the daemon reports it → its display form (`~/…` when it is under a home directory). */
export function displayPath(path: string): string {
  return path.replace(PATH_RE, '~');
}

/** Free text (a unit's output, a finding's message, a deliver card) with every home path → `~/…`. */
export function displayText(text: string): string {
  return text.replace(TEXT_RE, '$1~');
}
