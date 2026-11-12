import { ApiError } from '../../api/errors.js';
import { sourcesApi, type McpServer } from '../../api/sources.js';
import { keychainRef } from './sourceModel.js';

/**
 * RE-KEY A SAVED SOURCE: the one place both sheets write a secret typed again (crew's `PUT /mcp/servers/:name/secret`).
 *
 * crew writes it only for a server whose `auth.ref` is its OWN keychain entry (`keychain:wicked-mcp/<name>`, crew#719);
 * a secret crew reads from a daemon env variable or another entry can't be typed again here. One write per source is
 * out at a time, across the sheet (or the page) closing and opening again: a reopened sheet waits for it and hears how
 * it ended, and the mounted Sources page reads crew again when it settles.
 */

/** crew's rule for a secret value (`secretValue` in crew's MCP routes): 8 to 8192 characters, one line. */
export const SECRET_MIN = 8;
export const SECRET_MAX = 8192;

/** What crew would refuse in the value it is sent, said before sending; `null` when crew takes it. */
export function secretShapeProblem(value: string, what: string): string | null {
  if (value.length < SECRET_MIN) return `A ${what} is at least ${SECRET_MIN} characters. Nothing was written.`;
  if (value.length > SECRET_MAX) return `A ${what} is at most ${SECRET_MAX} characters. Nothing was written.`;
  if (/[\r\n\0]/.test(value)) return `A ${what} is one line. Nothing was written.`;
  return null;
}

/** Whether crew can write this source's secret again: it references its own keychain entry. */
export function ownsKeychainEntry(server: Pick<McpServer, 'name' | 'auth'> | null | undefined): boolean {
  return server != null && server.auth?.ref === keychainRef(server.name);
}

/** The prefix of a GitHub source's `auth.ref` that names the GitHub CLI login crew reads at use (no secret at all). */
export const GH_CLI_REF = 'gh-cli:';

/** The `auth.ref` a GitHub source saved with the GitHub CLI option carries for `login`. */
export const ghCliRef = (login: string): string => `${GH_CLI_REF}${login}`;

/** The GitHub login a saved source's `auth.ref` names, or `null` when it does not use the GitHub CLI. */
export function ghCliLoginOf(server: Pick<McpServer, 'auth'> | null | undefined): string | null {
  const ref = server?.auth?.ref;
  return typeof ref === 'string' && ref.startsWith(GH_CLI_REF) && ref.length > GH_CLI_REF.length ? ref.slice(GH_CLI_REF.length) : null;
}

/** Where crew reads a saved source's secret: its own keychain entry, a daemon variable, another keychain entry, the GitHub CLI's login (no secret), none. */
export function secretRefKind(server: Pick<McpServer, 'name' | 'auth'> | null | undefined): 'own' | 'env' | 'other' | 'gh' | 'none' {
  const ref = server?.auth?.ref;
  if (server == null || typeof ref !== 'string' || ref === '') return 'none';
  if (ref.startsWith(GH_CLI_REF)) return 'gh';
  return ref === keychainRef(server.name) ? 'own' : ref.startsWith('env:') ? 'env' : 'other';
}

/** What a sheet says when crew reads the secret somewhere studio can't type it again. */
export function elsewhereWords(kind: 'env' | 'other', what: string): string {
  return kind === 'env'
    ? `crew reads this ${what} from a variable of the crew daemon, so it can’t be typed again here: set that variable where crew runs.`
    : `crew reads this ${what} from a keychain entry another source owns, so it can’t be typed again here: replace it on that source.`;
}

const pending = new Map<string, Promise<unknown>>();
/** How each source's last write ended, until a sheet on the page says it (it may settle while no sheet is open). */
const outcomes = new Map<string, 'saved' | 'refused' | 'unknown'>();
const listeners = new Set<(name: string) => void>();

/** The re-key of `name` still out, if any (the sheet that sent it may have closed). */
export function rekeyPending(name: string): Promise<unknown> | null {
  return pending.get(name) ?? null;
}

/** Called with the source's name whenever a re-key settles, whichever sheet sent it. Returns the unsubscribe. */
export function onRekeySettled(fn: (name: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Send the one write. The value rides this request's body only. */
export function rekeySource(name: string, value: string): Promise<unknown> {
  const p = sourcesApi.setSecret(name, value);
  pending.set(name, p);
  const done = (outcome: 'saved' | 'refused' | 'unknown'): void => {
    if (pending.get(name) === p) pending.delete(name);
    outcomes.set(name, outcome);
    for (const fn of [...listeners]) fn(name);
  };
  p.then(() => done('saved'), (e: unknown) => done(rekeyFailure(e).kind));
  return p;
}

/** How the last write of `name` ended, once: the sheet that says it takes it. `null` when none is left to say. */
export function takeRekeyOutcome(name: string): 'saved' | 'refused' | 'unknown' | null {
  const o = outcomes.get(name) ?? null;
  outcomes.delete(name);
  return o;
}

/**
 * crew's answers that come BEFORE it writes anything (crew's PUT route and `setSecret`): a body it refuses (400), an
 * actor it refuses (401/403), an unknown source (404), no OS store (501), no registry (503). Each is crew's own JSON
 * (`{error, code?}`); the same status from anything else (a proxy's page) proves nothing. A 502 is the store's own
 * failure, which can follow the write (the macOS store writes, then checks), so it is no proof either.
 */
const BEFORE_WRITE: ReadonlySet<number> = new Set([400, 401, 403, 404, 501, 503]);

/**
 * What a failed write means. `refused`: crew refused it before writing, so nothing was written. `unknown`: no answer
 * that proves that (a dropped connection, another server's page, the store failing), so crew may have written it.
 */
export function rekeyFailure(e: unknown): { kind: 'refused'; status: number; code: string | null } | { kind: 'unknown' } {
  if (!(e instanceof ApiError) || !BEFORE_WRITE.has(e.status)) return { kind: 'unknown' };
  const b = e.body as { error?: unknown; code?: unknown } | null | undefined;
  if (typeof b !== 'object' || b === null || typeof b.error !== 'string') return { kind: 'unknown' };
  return { kind: 'refused', status: e.status, code: typeof b.code === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(b.code) ? b.code : null };
}

/**
 * The sheet's words for crew's refusal. Fixed sentences only: crew's own text is never shown here, so an answer that
 * quotes what was sent (escaped or not) can't put it on the page.
 */
export function refusalWords(f: { status: number; code: string | null }, what: string): string {
  const said = f.code === 'pm_source_human_only' ? `Only a person signed in to studio can replace a project-management source’s ${what}.`
    : f.code === 'secret_not_referenced' ? `crew no longer reads this ${what} from the source’s own keychain entry, so it can’t be typed again here.`
      : f.code === 'secret_store_unavailable' ? `crew has no OS secret store on this machine to keep the ${what} in.`
        : f.code === 'secret_in_ref' ? `crew refused the ${what}: it appears in the source’s own keychain reference; choose a different one.`
          : f.status === 404 ? 'crew no longer has this source: it was removed since this page was read.'
            : f.status === 400 ? `crew refused the ${what}: it takes one line of ${SECRET_MIN} to ${SECRET_MAX} characters.`
              : `crew refused the ${what} (${f.code ?? `HTTP ${f.status}`}).`;
  return `${said} Nothing was written.`;
}

/** Test seam: forget every write still out, and every listener. */
export function resetRekeysForTests(): void {
  pending.clear();
  outcomes.clear();
  listeners.clear();
}
