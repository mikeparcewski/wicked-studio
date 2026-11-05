import { ApiError } from '../../api/errors.js';
import { sourcesApi, type McpServer } from '../../api/sources.js';
import { keychainRef } from './sourceModel.js';

/**
 * RE-KEY A SAVED SOURCE: the one place both sheets write a secret typed again (crew's `PUT /mcp/servers/:name/secret`).
 *
 * crew writes it only for a server whose `auth.ref` is its OWN keychain entry (`keychain:wicked-mcp/<name>`, crew#719);
 * a secret crew reads from a daemon env variable or another entry can't be typed again here. One write per source is
 * out at a time, across the sheet closing and opening again: a reopened sheet waits for it rather than racing it.
 */

/** crew's rule for a secret value (`secretValue` in crew's MCP routes): 8 to 8192 characters, one line. */
export const SECRET_MIN = 8;

/** Whether crew can write this source's secret again: it references its own keychain entry. */
export function ownsKeychainEntry(server: Pick<McpServer, 'name' | 'auth'> | null | undefined): boolean {
  return server != null && server.auth?.ref === keychainRef(server.name);
}

const pending = new Map<string, Promise<unknown>>();

/** The re-key of `name` still out, if any (the sheet that sent it may have closed). */
export function rekeyPending(name: string): Promise<unknown> | null {
  return pending.get(name) ?? null;
}

/** Send the one write. The value rides this request's body only. */
export function rekeySource(name: string, value: string): Promise<unknown> {
  const p = sourcesApi.setSecret(name, value);
  pending.set(name, p);
  const done = (): void => { if (pending.get(name) === p) pending.delete(name); };
  p.then(done, done);
  return p;
}

/**
 * What a failed write means. `refused`: crew answered with its own refusal (a code word), so nothing was written. `unknown`:
 * no answer studio can read (the connection dropped, a proxy's error page), so crew may have written it.
 */
export function rekeyFailure(e: unknown): { kind: 'refused'; code: string; said: string } | { kind: 'unknown'; said: string } {
  const said = e instanceof Error ? e.message : String(e);
  const code = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
  return typeof code === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(code) ? { kind: 'refused', code, said } : { kind: 'unknown', said };
}

/** Test seam: forget every write still out. */
export function resetRekeysForTests(): void {
  pending.clear();
}
