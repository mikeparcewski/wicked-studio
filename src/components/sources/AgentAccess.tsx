import { useEffect, useState } from 'react';
import { agentAccessOf, sourceAgentsApi, type SourceAgentAccess, type SourceAgentAccessBody, type SourceAgentQuery } from '../../api/sourceAgents.js';
import { sessionPath } from '../../board/sessionModel.js';

/** What turning query on means, said on the sheet whether it is on or off (DES-APPS-001 rev 12 §5.4). */
export const AGENT_QUERY_CONSEQUENCE =
  "Rows from this source go to the agent's model provider. crew checks each query first, reads it read-only, and gives at most 200 rows.";
export const AGENT_SEE_MEANS = 'Agents in the projects below can list it and read its structure: tables, columns, types and keys. Never a row, never its login.';

/** One line for the projects the source reaches. */
export function projectsWords(a: SourceAgentAccess, names: ReadonlyMap<string, string>): string {
  if (a.everyProject) return 'Every project on this daemon.';
  if (a.projects.length === 0) return 'No project yet: no agent can use it until you choose one.';
  return `${a.projects.map((p) => names.get(p) ?? p).join(', ')}.`;
}

/**
 * THE AGENT CONTROLS of a saved `sql`/`graphql` source (DES-APPS-001 rev 12 §5.4): "Agents can see this
 * structure", "Agents can query this source" (off on a new source; it says that rows go to the agent's
 * model provider; turning it on takes a second, explicit confirmation), and the projects whose agents may use
 * it (none on a new source). Below them, the source's recent agent queries, each linking to its job.
 *
 * Human-only in the UI as at crew (which answers 403 to anything but a human operator): this component is
 * the ONLY caller of `sourceAgentsApi.setAgentAccess` (pinned by `tests/sourceAgentsHumanOnly.test.ts`), and
 * it changes a control only on a click. No URL parameter, palette verb, plugin request or chat reply reaches it.
 */
export function AgentAccess({ source, kind, agents, onChanged, 'data-testid': testId = 'source-agents' }: {
  source: string;
  /** `sql` sources can be queried; a GraphQL source is catalog-only for agents. */
  kind: 'sql' | 'graphql';
  agents: unknown;
  onChanged: (agents: SourceAgentAccess) => void;
  'data-testid'?: string;
}): React.ReactElement {
  const a = agentAccessOf({ agents });
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [recent, setRecent] = useState<SourceAgentQuery[] | null | 'unknown'>(null);

  useEffect(() => {
    let live = true;
    // Read-only calls; a crew without them (or a failed read) leaves an empty list and "not known".
    Promise.resolve().then(() => sourceAgentsApi.projects()).then(
      // "Unfiled" (crew's synthesized `default`) is no project a run is filed into: "Every project" covers it.
      (r) => { if (live) setProjects(Array.isArray(r?.projects) ? r.projects.filter((p) => p.id !== 'default').map((p) => ({ id: p.id, name: p.name })) : []); },
      () => { if (live) setProjects([]); },
    );
    Promise.resolve().then(() => sourceAgentsApi.agentQueries(source)).then(
      (r) => { if (live) setRecent(r?.known === true && Array.isArray(r.queries) ? r.queries : 'unknown'); },
      () => { if (live) setRecent('unknown'); },
    );
    return () => { live = false; };
  }, [source]);

  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const apply = async (body: SourceAgentAccessBody): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const r = await sourceAgentsApi.setAgentAccess(source, body);
      setAsking(false);
      onChanged(r.agents);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const toggleProject = (id: string, on: boolean): void => {
    const next = on ? [...new Set([...a.projects, id])] : a.projects.filter((p) => p !== id);
    void apply({ projects: next });
  };
  const queryable = kind === 'sql';

  return (
    <div className="wk-src-box wk-src-writes" data-testid={testId} data-see={a.see ? 'on' : 'off'} data-query={a.query ? 'on' : 'off'}>
      <p className="wk-src-strong">Agents</p>

      <div className="wk-src-writes-head">
        <button
          type="button"
          role="switch"
          aria-checked={a.see}
          aria-label={`Agents can see the structure of ${source}`}
          data-testid={`${testId}-see`}
          disabled={busy || asking}
          className={`wk-src-toggle${a.see ? ' wk-src-toggle--on' : ''}`}
          onClick={() => void apply({ see: !a.see })}
        >
          <span aria-hidden className="wk-src-toggle-thumb" />
        </button>
        <span className="wk-src-strong">Agents can see this structure</span>
        <span className="wk-src-sp" />
        <span className="wk-src-cap" data-testid={`${testId}-see-state`}>{a.see ? 'on' : 'off'}</span>
      </div>
      <p className="wk-src-note">{AGENT_SEE_MEANS}</p>

      {queryable ? (
        <>
          <div className="wk-src-writes-head">
            <button
              type="button"
              role="switch"
              aria-checked={a.query}
              aria-label={`Agents can query ${source}`}
              data-testid={`${testId}-query`}
              disabled={busy || asking || !a.see}
              className={`wk-src-toggle${a.query ? ' wk-src-toggle--on' : ''}`}
              onClick={() => { setError(null); if (a.query) void apply({ query: false }); else setAsking(true); }}
            >
              <span aria-hidden className="wk-src-toggle-thumb" />
            </button>
            <span className="wk-src-strong">Agents can query this source</span>
            <span className="wk-src-sp" />
            <span className="wk-src-cap" data-testid={`${testId}-query-state`}>{a.query ? 'on' : 'off'}</span>
          </div>
          <p className="wk-src-note" data-testid={`${testId}-consequence`}>{AGENT_QUERY_CONSEQUENCE}</p>
          {!a.see && <p className="wk-src-note">Turn on “see” first: agents query only a structure they can see.</p>}
          {asking && (
            <div className="wk-src-confirm" role="group" aria-label="Turn on agent queries" data-testid={`${testId}-confirm`}>
              <p>
                Let agents query <b>{source}</b>? Rows they read go to their model provider. Writes stay impossible, and you can turn it
                off at any time: the next query is refused, even in a job that is running.
              </p>
              <div className="wk-src-row-btns">
                <button type="button" className="wk-btn wk-btn--primary" disabled={busy} data-testid={`${testId}-confirm-on`} onClick={() => void apply({ query: true })}>{busy ? 'Turning on…' : 'Turn on'}</button>
                <button type="button" className="wk-btn wk-btn--quiet" disabled={busy} onClick={() => setAsking(false)}>Keep it off</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="wk-src-note" data-testid={`${testId}-catalog-only`}>Agents can read a GraphQL source’s structure, not query it.</p>
      )}

      <fieldset className="wk-src-field" data-testid={`${testId}-projects`} disabled={busy || asking}>
        <legend className="wk-src-label">Projects whose agents may use it</legend>
        <p className="wk-src-note" data-testid={`${testId}-projects-state`}>{projectsWords(a, names)}</p>
        <label className="wk-src-check-row">
          <input type="checkbox" data-testid={`${testId}-every`} checked={a.everyProject} onChange={(e) => void apply({ everyProject: e.target.checked })} />
          <span className="wk-src-note">Every project on this daemon, and jobs and chats in none</span>
        </label>
        {projects === null ? <p className="wk-src-cap">Reading the projects…</p> : projects.map((p) => (
          <label key={p.id} className="wk-src-check-row">
            <input type="checkbox" data-testid={`${testId}-project-${p.id}`} checked={a.projects.includes(p.id)} disabled={a.everyProject} onChange={(e) => toggleProject(p.id, e.target.checked)} />
            <span className="wk-src-note">{p.name}</span>
          </label>
        ))}
      </fieldset>

      {error !== null && <p role="alert" className="wk-src-note wk-src-tone-fail" data-testid={`${testId}-error`}>{error}</p>}

      <div data-testid={`${testId}-recent`}>
        <p className="wk-src-label">Recent agent queries</p>
        {recent === null ? <p className="wk-src-cap">Reading…</p>
          : recent === 'unknown' ? <p className="wk-src-note" data-testid={`${testId}-recent-unknown`}>crew’s record of agent queries could not be read.</p>
            : recent.length === 0 ? <p className="wk-src-note" data-testid={`${testId}-recent-none`}>No agent has queried it yet.</p>
              : (
                <ul className="wk-src-list">
                  {recent.map((q) => (
                    <li key={q.callId} className="wk-src-note" data-testid={`${testId}-recent-row`}>
                      <time dateTime={q.at}>{new Date(q.at).toLocaleString()}</time>
                      {' · '}<a href={sessionPath(`run:${q.runId}`)}>job {q.runId.slice(0, 8)}</a>
                      {' · '}{q.seat}
                      {' · '}{q.released ? `${q.rows} row${q.rows === 1 ? '' : 's'}${q.truncated ? ' (cut)' : ''}` : `refused: ${q.outcome}`}
                    </li>
                  ))}
                </ul>
              )}
      </div>
    </div>
  );
}
