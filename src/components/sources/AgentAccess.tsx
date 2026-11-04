import { useEffect, useRef, useState } from 'react';
import {
  agentAccessAnswer,
  agentQueriesOf,
  agentSwitchRefusal,
  agentSwitchRereads,
  agentSwitchWrites,
  projectsOf,
  sourceAgentsApi,
  type SourceAgentAccess,
  type SourceAgentAccessBody,
  type SourceAgentQuery,
} from '../../api/sourceAgents.js';
import { sessionPath } from '../../board/sessionModel.js';

/** What turning query on means, said on the sheet whether it is on or off (DES-KNOWLEDGE-DATA-001 §7.1, §7.4). */
export const AGENT_QUERY_CONSEQUENCE =
  "Rows from this source go to the agent's model provider. crew checks each query first, reads it read-only, and gives at most 200 rows.";
export const AGENT_SEE_MEANS = 'Agents in the projects below can list it and read its structure: tables, columns, types and keys. Never a row, never its login.';
/** Outcomes where the query ran but its rows never reached the agent (crew withheld them at release). */
const NOT_RELEASED = new Set(['unconfirmed', 'changed_while_running', 'record_failed']);

/** One line for the projects the source reaches. */
export function projectsWords(a: SourceAgentAccess, names: ReadonlyMap<string, string>): string {
  if (a.everyProject) return 'Every project on this daemon.';
  if (a.projects.length === 0) return 'No project yet: no agent can use it until you choose one.';
  return `${a.projects.map((p) => names.get(p) ?? p).join(', ')}.`;
}

/**
 * THE AGENTS BOX of a saved SQL source (DES-KNOWLEDGE-DATA-001 §7.1, §19 B5): "Agents can see this structure"
 * (on for a new source), "Agents can query this source" (off for a new source; Postgres only, the one dialect
 * crew's gate reads rows from; it says that rows go to the agent's model provider; turning it on takes a second,
 * explicit confirmation), and the projects whose agents may use it (none for a new source, or "every project").
 * Below them, the source's recent agent reads, each linking to its job.
 *
 * Every switch shows crew's answer, never a guess: a change is sent, the box waits for crew, and shows what crew
 * says it now holds. One write runs at a time in a box; across boxes (a sheet closed and opened again while its
 * write ran) the newest write's answer wins (`agentSwitchWrites`), and an older one makes the page read crew
 * afresh rather than undo the newer switch.
 *
 * Human-only in the UI as at crew (403 `agents_switch_human_only` to anything but a human operator): this is the
 * ONLY caller of `sourceAgentsApi.setAgentAccess` (pinned by `tests/sourceAgentsHumanOnly.test.ts`), and it changes
 * a switch only on a click. No URL parameter, palette verb, plugin request or chat reply reaches it.
 */
export function AgentAccess({ source, dialect, agents, onChanged, onStale, 'data-testid': testId = 'source-agent-controls' }: {
  source: string;
  /** Only a Postgres source can be queried by agents in this release; MySQL and uploads are structure only. */
  dialect: 'postgres' | 'mysql' | 'sqlite';
  /** crew's switches for the source (the sheet shows no box when crew sent none). */
  agents: SourceAgentAccess;
  /** crew answered a change: the switches it now holds. */
  onChanged: (agents: SourceAgentAccess) => void;
  /** The shown switches may be older than crew's (an older write answered late, or crew refused a stale change). */
  onStale: () => void;
  'data-testid'?: string;
}): React.ReactElement {
  const a = agents;
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }> | null>(null);
  const [recent, setRecent] = useState<SourceAgentQuery[] | null | 'unknown'>(null);

  const confirmOn = useRef<HTMLButtonElement | null>(null);
  // The confirmation takes focus when it opens, so a keyboard or screen-reader user meets it.
  useEffect(() => {
    if (asking) confirmOn.current?.focus();
  }, [asking]);

  useEffect(() => {
    let live = true;
    // Another source's projects and reads never show under this one.
    setProjects(null);
    setRecent(null);
    // Read-only calls; a crew without them (or a failed read) leaves an empty list and "not known".
    Promise.resolve().then(() => sourceAgentsApi.projects()).then(
      (r) => { if (live) setProjects(projectsOf(r)); },
      () => { if (live) setProjects([]); },
    );
    Promise.resolve().then(() => sourceAgentsApi.agentQueries(source)).then(
      (r) => { if (live) setRecent(agentQueriesOf(r, source)); },
      () => { if (live) setRecent('unknown'); },
    );
    return () => { live = false; };
  }, [source]);

  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const apply = async (body: SourceAgentAccessBody): Promise<void> => {
    const ticket = agentSwitchWrites.take(source);
    setBusy(true);
    setError(null);
    try {
      const r = await sourceAgentsApi.setAgentAccess(source, body);
      // A newer write was sent for this source since: its answer is the one to show, and crew is read afresh.
      if (!agentSwitchWrites.isNewest(source, ticket)) { onStale(); return; }
      const next = agentAccessAnswer(r, source);
      if (next === null) {
        setError('crew’s answer could not be read, so the switches are read again from crew.');
        onStale();
        return;
      }
      setAsking(false);
      onChanged(next);
    } catch (e) {
      if (!agentSwitchWrites.isNewest(source, ticket)) { onStale(); return; }
      setAsking(false);
      setError(agentSwitchRefusal(e));
      if (agentSwitchRereads(e)) onStale();
    } finally {
      setBusy(false);
    }
  };
  const toggleProject = (id: string, on: boolean): void => {
    const next = on ? [...new Set([...a.projects, id])] : a.projects.filter((p) => p !== id);
    void apply({ projects: next });
  };
  // A project the source names that is no longer active still shows, so a person can take it away.
  const listed = projects === null ? [] : [...projects, ...a.projects.filter((p) => !projects.some((x) => x.id === p)).map((p) => ({ id: p, name: `${p} (not an active project)` }))];
  const queryable = dialect === 'postgres';

  return (
    <div className="wk-src-box wk-src-writes" data-testid={testId} data-see={a.see ? 'on' : 'off'} data-query={a.query ? 'on' : 'off'} aria-busy={busy}>
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
          {!a.see && <p className="wk-src-note" data-testid={`${testId}-see-first`}>Turn on “see” first: agents query only a structure they can see.</p>}
          {asking && (
            <div className="wk-src-confirm" role="group" aria-label="Turn on agent queries" data-testid={`${testId}-confirm`}>
              <p>
                Let agents query <b style={{ overflowWrap: 'anywhere' }}>{source}</b>? Rows they read go to their model provider. Writes stay impossible, and you can turn it
                off at any time: the next query is refused, even in a job that is running.
              </p>
              <div className="wk-src-row-btns">
                <button ref={confirmOn} type="button" className="wk-btn wk-btn--primary" disabled={busy} data-testid={`${testId}-confirm-on`} onClick={() => void apply({ query: true })}>{busy ? 'Turning on…' : 'Turn on'}</button>
                <button type="button" className="wk-btn wk-btn--quiet" disabled={busy} data-testid={`${testId}-confirm-off`} onClick={() => setAsking(false)}>Keep it off</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="wk-src-note" data-testid={`${testId}-structure-only`}>
          Agents can read {dialect === 'mysql' ? 'a MySQL source’s' : 'an uploaded file’s'} structure, not query it: crew reads rows for agents from Postgres sources only, for now.
        </p>
      )}

      <fieldset className="wk-src-field" data-testid={`${testId}-projects`} disabled={busy || asking}>
        <legend className="wk-src-label">Projects whose agents may use it</legend>
        <p className="wk-src-note" data-testid={`${testId}-projects-state`}>{projectsWords(a, names)}</p>
        <label className="wk-src-check-row">
          <input type="checkbox" data-testid={`${testId}-every`} checked={a.everyProject} onChange={(e) => void apply({ everyProject: e.target.checked })} />
          <span className="wk-src-note">Every project on this daemon, and jobs and chats in none</span>
        </label>
        {projects === null ? <p className="wk-src-cap">Reading the projects…</p> : listed.map((p) => (
          <label key={p.id} className="wk-src-check-row">
            <input type="checkbox" data-testid={`${testId}-project-${p.id}`} checked={a.projects.includes(p.id)} disabled={a.everyProject} onChange={(e) => toggleProject(p.id, e.target.checked)} />
            <span className="wk-src-note">{p.name}</span>
          </label>
        ))}
      </fieldset>
      {busy && <p className="wk-src-cap" data-testid={`${testId}-busy`}>Asking crew…</p>}

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
                      {' · '}{q.released ? `${q.rows} row${q.rows === 1 ? '' : 's'}${q.truncated === true ? ' (cut)' : ''}` : NOT_RELEASED.has(q.outcome) ? 'rows withheld' : `refused: ${q.outcome}`}
                    </li>
                  ))}
                </ul>
              )}
      </div>
    </div>
  );
}
