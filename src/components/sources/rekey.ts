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

const pending = new Map<string, Promise<unknown>>();
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
  const done = (): void => {
    if (pending.get(name) === p) pending.delete(name);
    for (const fn of [...listeners]) fn(name);
  };
  p.then(done, done);
  return p;
}

/**
 * crew's answers that come BEFORE it writes anything (crew's PUT route and `setSecret`): a body it refuses (400), an
 * actor it refuses (401/403), an unknown source (404), no OS store (501), no registry (503). A 502 is the store's own
 * failure, which can follow the write (the macOS store writes, then checks), so it is no proof that nothing was written.
 */
const BEFORE_WRITE: ReadonlySet<number> = new Set([400, 401, 403, 404, 501, 503]);

/**
 * What a failed write means. `refused`: crew refused it before writing, so nothing was written. `unknown`: no answer
 * that proves that (a dropped connection, a proxy's page, the store failing), so crew may have written it. crew's
 * sentence is kept, but never with the value in it: an answer that repeats any of `sent` is not shown.
 */
export function rekeyFailure(e: unknown, sent: readonly string[]): { kind: 'refused'; code: string | null; said: string } | { kind: 'unknown'; said: string } {
  const raw = e instanceof Error ? e.message : String(e);
  const said = sent.some((v) => v !== '' && raw.includes(v)) ? 'its answer repeated what you typed, so it is not shown' : raw;
  if (e instanceof ApiError && BEFORE_WRITE.has(e.status)) {
    const code = (e.body as { code?: unknown } | undefined)?.code;
    return { kind: 'refused', code: typeof code === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(code) ? code : null, said };
  }
  return { kind: 'unknown', said };
}

/** Test seam: forget every write still out, and every listener. */
export function resetRekeysForTests(): void {
  pending.clear();
  listeners.clear();
}
