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

/** The home directories a text names, as written (`/Users/reel-operator`) — distinct, in order. */
export function homeDirsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TEXT_RE)) {
    const dir = m[0].slice((m[1] ?? '').length);
    if (dir !== '' && !out.includes(dir)) out.push(dir);
  }
  return out;
}

/** What may follow a home directory in a stream for it to be one: a separator, whitespace, a quote,
 *  a closing bracket, or the start of an escape sequence (a coloured prompt ends its path with
 *  one) — so `/Users/ann` inside `/Users/annabel` is left alone. */
const AFTER_HOME = /[\/\\\s"'`)\]>\u001b]/;

/**
 * A LIVE stream (a terminal's output — studio#467) with each of `dirs` drawn as `~`. The stream
 * arrives in chunks cut anywhere, so the end of a chunk that could be the start of a directory —
 * or a whole directory whose next character has not arrived — is held back until the next chunk,
 * or until `flush` (the caller's idle timer: nothing more is coming, so the held text is drawn,
 * a whole directory as `~`). Display only: what is typed and run is untouched.
 */
export function homeMasker(dirs: readonly string[]): { push: (chunk: string) => string; flush: () => string } {
  const needles = [...new Set(dirs)].filter((d) => d.length > 1).sort((a, b) => b.length - a.length);
  let carry = '';
  const mask = (s: string, atEnd: boolean): { out: string; held: string } => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      const hit = needles.find((n) => s.startsWith(n, i));
      if (hit !== undefined) {
        const next = s.charAt(i + hit.length);
        if (next === '') {
          if (atEnd) { out += '~'; i += hit.length; continue; }
          return { out, held: s.slice(i) }; // the next character decides
        }
        if (AFTER_HOME.test(next)) { out += '~'; i += hit.length; continue; }
      } else if (!atEnd) {
        const rest = s.slice(i);
        if (needles.some((n) => n.length > rest.length && n.startsWith(rest))) return { out, held: rest };
      }
      out += s.charAt(i);
      i += 1;
    }
    return { out, held: '' };
  };
  return {
    push(chunk: string): string {
      if (needles.length === 0) return chunk;
      const { out, held } = mask(carry + chunk, false);
      carry = held;
      return out;
    },
    flush(): string {
      const { out } = mask(carry, true);
      carry = '';
      return out;
    },
  };
}
