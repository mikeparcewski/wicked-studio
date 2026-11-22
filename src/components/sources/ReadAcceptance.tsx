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

/**
 * The tools the box lists: crew sends their acceptance, and each is a registered read (it can be accepted) or is
 * accepted now, whatever its status (review r1: a tool that changed or went away keeps its acceptance at crew, so it
 * stays here to be withdrawn).
 */
export function acceptableReads(server: Pick<McpServer, 'tools'>): AcceptableTool[] {
  return (server.tools as AcceptableTool[]).filter((t) => typeof t.readAccepted === 'boolean' && (t.readAccepted || (t.class === 'read' && t.status === 'registered')));
}

/** Why an accepted tool can only be withdrawn: crew accepts only a registered schema. */
function statusWords(t: AcceptableTool): string | null {
  if (t.status === 'gone') return 'no longer offered by the source';
  if (t.status !== 'registered') return 'changed since the source was saved';
  return null;
}

/**
 * "APP READS" on a saved REST or MCP source (the source sheet), and on every MCP server (the MCP tools page, which
 * also manages local stdio servers the Sources page doesn't list): each read operation, accepted (or not) as a read an app may make. An app's
 * query on an operation that isn't accepted is refused by crew, so this is where a source saved without the tick, or a
 * read added since, is accepted; a withdraw takes one away. Each toggle is one `PATCH /mcp/tools/:subject
 * {readAccepted}` (a person only), and the row shows crew's answer.
 */
export function ReadAcceptance({ server, onChanged }: { server: McpServer; onChanged?: (() => void) | undefined }): React.ReactElement | null {
  /** crew's answers to this sheet's toggles, by subject; a newer record of the source replaces them. */
  const [answered, setAnswered] = useState<Readonly<Record<string, boolean>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ subject: string; words: string } | null>(null);
  /** Toggles whose answer was lost: crew may have made the change, so the row claims neither state (review r2). */
  const [unknown, setUnknown] = useState<ReadonlySet<string>>(() => new Set());
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setAnswered({}); setUnknown(new Set()); }, [server]);

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
      if (alive.current) {
        setAnswered((m) => ({ ...m, [t.subject]: tool.readAccepted === true }));
        setUnknown((u) => { const n = new Set(u); n.delete(t.subject); return n; });
      }
    } catch (e) {
      if (alive.current) {
        const code = e instanceof ApiError ? (e.body as { code?: unknown } | undefined)?.code : undefined;
        setError({ subject: t.subject, words: typeof code === 'string' && Object.hasOwn(REFUSALS, code) ? REFUSALS[code]! : e instanceof Error ? e.message : String(e) });
        // No answer from crew (not a refusal): the change may have been made.
        if (!(e instanceof ApiError)) setUnknown((u) => new Set(u).add(t.subject));
      }
    } finally {
      if (alive.current) setBusy(null);
      // Whatever came back (a lost answer may still have changed it), the page reads crew again, even after this
      // sheet closed (review r1): a reopened sheet shows crew's record, not the one from before the write.
      onChanged?.();
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
          const away = statusWords(t);
          const notKnown = unknown.has(t.subject);
          return (
            <li key={t.subject}>
              <label className="wk-src-check-row" data-testid="source-read-accept" data-tool={t.name} data-accepted={notKnown ? 'unknown' : on ? 'true' : 'false'}>
                <input type="checkbox" checked={on} disabled={busy !== null || (away !== null && !on)} data-testid="source-read-accept-tick"
                  onChange={(e) => void toggle(t, e.target.checked)} />
                <span className="wk-src-note"><code className="wk-src-mono">{t.name}</code>{busy === t.subject ? (on ? ' · withdrawing…' : ' · accepting…') : notKnown ? ' · not known: Studio couldn’t confirm that change' : on ? ' · accepted as a read' : away !== null ? ' · withdrawn' : ' · not accepted: apps can’t query it'}{away !== null && <span data-testid="source-read-accept-away">{` (${away}${on ? ': you can withdraw it' : ''})`}</span>}</span>
              </label>
              {error !== null && error.subject === t.subject && <p role="alert" className="wk-src-note wk-src-tone-warn" data-testid="source-read-accept-error">{error.words}</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
