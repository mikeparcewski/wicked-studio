import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/errors.js';
import { mcpApi, type McpServer, type McpTool } from '../../api/mcp.js';

/**
 * (crew#1295, api-types 0.219.0) A tool's Apps read acceptance: `true` while the person's acceptance is in force
 * for its saved schema. Studio pins an older api-types, so the field is typed here; an older crew sends none.
 */
type AcceptableTool = McpTool & { readAccepted?: boolean };

/** crew's refusals of an accept or withdraw (`mcp/registry.ts` patchTool), in plain words. */
const REFUSALS: Readonly<Record<string, string>> = {
  read_accept_human_only: 'Only a person signed in to studio can accept or withdraw a read.',
  not_a_read: 'crew doesn’t class this operation as a read, so it can’t be accepted as one.',
  not_registered: 'This operation changed since the source was saved: test and save the source again, then accept it.',
};

/** The tools a saved REST or MCP source's box lists: crew sends their acceptance, and each is a read or is accepted. */
export function acceptableReads(server: Pick<McpServer, 'tools'>): AcceptableTool[] {
  return (server.tools as AcceptableTool[]).filter((t) => t.status === 'registered' && typeof t.readAccepted === 'boolean' && (t.class === 'read' || t.readAccepted));
}

/**
 * "APP READS" on a saved REST or MCP source: each read operation, accepted (or not) as a read an app may make. An app's
 * query on an operation that isn't accepted is refused by crew, so this is where a source saved without the tick, or a
 * read added since, is accepted; a withdraw takes one away. Each toggle is one `PATCH /mcp/tools/:subject
 * {readAccepted}` (a person only), and the row shows crew's answer.
 */
export function ReadAcceptance({ server, onChanged }: { server: McpServer; onChanged?: (() => void) | undefined }): React.ReactElement | null {
  /** crew's answers to this sheet's toggles, by subject; a newer record of the source replaces them. */
  const [answered, setAnswered] = useState<Readonly<Record<string, boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ subject: string; words: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setAnswered({}); }, [server]);

  const tools = acceptableReads(server);
  if (tools.length === 0) return null;
  const accepted = (t: AcceptableTool): boolean => answered[t.subject] ?? t.readAccepted === true;
  const count = tools.filter(accepted).length;

  const toggle = async (t: AcceptableTool, on: boolean): Promise<void> => {
    if (busy !== null) return;
    setBusy(t.subject);
    setError(null);
    try {
      const tool = (await mcpApi.setTool(t.subject, { readAccepted: on })) as AcceptableTool;
      if (!alive.current) return;
      setAnswered((m) => ({ ...m, [t.subject]: tool.readAccepted === true }));
      onChanged?.();
    } catch (e) {
      if (!alive.current) return;
      const code = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
      setError({ subject: t.subject, words: typeof code === 'string' && Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : e instanceof Error ? e.message : String(e) });
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  return (
    <div className="wk-src-box" data-testid="source-read-acceptance">
      <div className="wk-src-box-head">
        <span className="wk-src-strong">App reads</span>
        <span className="wk-src-sp" />
        <span className="wk-src-cap" data-testid="source-read-acceptance-count">{count} of {tools.length} accepted</span>
      </div>
      <p className="wk-src-note">An app can query only the operations accepted here. crew can’t stop an API that changes data on a GET or a read-only tool: accept only what you trust to read.</p>
      <ul className="wk-src-plain">
        {tools.map((t) => {
          const on = accepted(t);
          return (
            <li key={t.subject}>
              <label className="wk-src-check-row" data-testid="source-read-accept" data-tool={t.name} data-accepted={on ? 'true' : 'false'}>
                <input type="checkbox" checked={on} disabled={busy !== null} data-testid="source-read-accept-tick"
                  onChange={(e) => void toggle(t, e.target.checked)} />
                <span className="wk-src-note"><code className="wk-src-mono">{t.name}</code>{busy === t.subject ? (on ? ' · withdrawing…' : ' · accepting…') : on ? ' · accepted as a read' : ' · not accepted: apps can’t query it'}</span>
              </label>
              {error !== null && error.subject === t.subject && <p role="alert" className="wk-src-note wk-src-tone-warn" data-testid="source-read-accept-error">{error.words}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
