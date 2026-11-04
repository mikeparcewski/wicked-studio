import { AlertTriangle, Check, X } from 'lucide-react';
import type { SourceConnectionTestResponse, SourcePrivilegeReport } from '../../api/sources.js';
import { privilegeLine } from './sourceModel.js';

/** One line of a test's result, in words. */
export interface TestLine {
  id: string;
  tone: 'ok' | 'warn' | 'fail';
  text: string;
}

const KIND_WORDS: Record<string, string> = { postgres: 'Postgres', mysql: 'MySQL', sqlite: 'an upload (SQLite)', graphql: 'GraphQL' };
const TLS_MODE: Record<string, string> = { postgres: 'verify-full', mysql: 'VERIFY_IDENTITY', graphql: 'HTTPS' };

/** "13:04:11" in the person's own clock. */
export function testedAtWords(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * What "Test connection" found, line by line: the same lines a new source's test shows (connected in
 * N ms, the TLS state, read-only or what the login can change), the read check, and when it ran. A
 * failure says why. No line carries the secret: crew never sends it back.
 */
export function connectionTestLines(t: SourceConnectionTestResponse): TestLine[] {
  const kind = KIND_WORDS[t.driver ?? t.kind] ?? t.kind;
  if (!t.ok) {
    return [
      { id: 'failed', tone: 'fail', text: `Not connected: ${t.error ?? 'the test failed'}${t.code !== undefined ? ` (${t.code})` : ''}` },
      { id: 'when', tone: 'warn', text: t.code === 'not_answered' ? `Tested at ${testedAtWords(t.testedAt)}: no answer after ${t.ms} ms of waiting` : `Tested at ${testedAtWords(t.testedAt)}, after ${t.ms} ms` },
    ];
  }
  const lines: TestLine[] = [
    { id: 'connected', tone: 'ok', text: t.tls === 'local' ? `Opened and described in ${t.ms} ms · ${kind}` : `Connected and described in ${t.ms} ms · ${kind}` },
    // The new-source test's words (SourceSheet), with the mode the connection was made under.
    {
      id: 'tls',
      tone: t.tls === 'off' ? 'warn' : 'ok',
      text: t.tls === 'verified' ? `TLS verified (${TLS_MODE[t.driver ?? t.kind] ?? 'verified'})` : t.tls === 'off' ? 'No TLS (allowed on this address)' : 'No connection: crew reads its own copy of the file',
    },
  ];
  const privileges: SourcePrivilegeReport | undefined = t.catalog?.privileges;
  if (privileges !== undefined) {
    const p = privilegeLine(privileges);
    lines.push({ id: 'privileges', tone: p.tone, text: p.text });
  } else if (t.driver === 'sqlite') {
    lines.push({ id: 'privileges', tone: 'ok', text: 'Read only: an upload is a copy, so it has no writes' });
  }
  const rc = t.readCheck;
  if (rc !== undefined && rc !== null) {
    lines.push(rc.ok
      ? { id: 'read', tone: 'ok', text: `Reads: a count of ${rc.relation} passes the read policy (checked, not run)` }
      : { id: 'read', tone: 'warn', text: `Reads: a count of ${rc.relation} was refused (${rc.code}): ${rc.detail}` });
  }
  lines.push({ id: 'when', tone: 'ok', text: `Tested at ${testedAtWords(t.testedAt)}` });
  return lines;
}

const ICON = { ok: Check, warn: AlertTriangle, fail: X } as const;

/** The result lines, as the sheet's Test box shows them. */
export function ConnectionTestLines({ result }: { result: SourceConnectionTestResponse }): React.ReactElement {
  return (
    <div className="wk-src-lines" role="status" data-testid="source-connection-test" data-ok={result.ok ? 'yes' : 'no'}>
      {connectionTestLines(result).map((l) => {
        const I = ICON[l.tone];
        return (
          <p key={l.id} className={l.tone === 'ok' ? 'wk-src-okline' : l.tone === 'warn' ? 'wk-src-okline wk-src-tone-warn' : 'wk-src-okline wk-src-tone-fail'} data-testid={`source-connection-test-${l.id}`} role={l.tone === 'fail' ? 'alert' : undefined}>
            <I size={16} aria-hidden className={`wk-src-ico ${l.tone === 'ok' ? 'wk-src-tone-ok' : l.tone === 'warn' ? 'wk-src-tone-warn' : 'wk-src-tone-fail'}`} />
            <span>{l.text}</span>
          </p>
        );
      })}
    </div>
  );
}
