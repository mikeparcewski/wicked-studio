import { useEffect, useState } from 'react';
import {
  compileWhen,
  EMPTY_WHEN,
  isMcpToken,
  mcpApi,
  ROLE_LABELS,
  subjectTokens,
  triggerIssue,
  type McpPhaseRole,
  type McpServer,
  type McpToolClass,
  type WhenSpec,
} from '../api/mcp.js';

/**
 * The MCP policy builders on the Steering rule form (DES-MCP-TOOLS-001 §4.7):
 *
 *  - **Subject**: pick a registered server, or one of its tools, from the MCP registry; it adds the
 *    `mcp:<server>` / `mcp:<server>/<tool>` token to the rule's `applies_to` (or `mcp` for every
 *    MCP call).
 *  - **When**: phase role, seat, class and an argument pattern, compiled by `compileWhen` into the
 *    rule's `trigger.contains`. The compiled regex is written into the form's trigger field, which
 *    stays visible and editable.
 */

const ROLES: McpPhaseRole[] = ['creator', 'evaluator', 'recon'];
const SEATS = ['claude', 'codex', 'opencode', 'copilot', 'pi', 'agy'];
const CLASSES: McpToolClass[] = ['read', 'write', 'destructive'];

function toggle<T>(xs: T[], x: T): T[] {
  return xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x];
}

export function SteeringMcpBuilder({ appliesTo, onAppliesTo, onTrigger }: {
  appliesTo: string[];
  onAppliesTo: (next: string[]) => void;
  /** Receives the compiled `trigger.contains` (`''` = no trigger). */
  onTrigger: (compiled: string) => void;
}): React.ReactElement {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [server, setServer] = useState('');
  const [tool, setTool] = useState('');
  const [when, setWhen] = useState<WhenSpec>(EMPTY_WHEN);

  useEffect(() => {
    let live = true;
    mcpApi.servers()
      .then((r) => { if (live) setServers(r.servers); })
      .catch((e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, []);

  const picked = servers?.find((s) => s.name === server) ?? null;
  const addSubject = (): void => {
    const tokens = server === '' ? ['mcp'] : subjectTokens(server, tool === '' ? null : tool);
    onAppliesTo([...appliesTo, ...tokens.filter((t) => !appliesTo.includes(t))]);
  };
  const compiled = compileWhen(when);
  const issue = triggerIssue(compiled);
  const box = 'flex items-center gap-1 text-[10px]';
  const subjects = appliesTo.filter(isMcpToken);

  return (
    <fieldset data-testid="steering-mcp-builder" className="flex flex-col gap-2 rounded p-2" style={{ border: '1px solid var(--surface-raised)' }}>
      <legend className="px-1 text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>MCP policy</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Subject: server
          <select
            data-testid="steering-mcp-server"
            value={server}
            onChange={(e) => { setServer(e.target.value); setTool(''); }}
            className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            <option value="">every MCP call (mcp)</option>
            {(servers ?? []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          tool
          <select
            data-testid="steering-mcp-tool"
            value={tool}
            disabled={picked === null}
            onChange={(e) => setTool(e.target.value)}
            className="rounded px-1.5 py-1 text-[11px] focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            <option value="">the whole server</option>
            {(picked?.tools ?? []).filter((t) => t.status !== 'gone').map((t) => (
              <option key={t.name} value={t.name}>{t.name} ({t.class})</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="steering-mcp-add-subject"
          onClick={addSubject}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
        >
          Add to applies to
        </button>
        {subjects.length > 0 && (
          <span className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>governs {subjects.join(', ')}</span>
        )}
      </div>
      {loadError !== null && (
        <p data-testid="steering-mcp-registry-error" className="text-[10px]" style={{ color: 'var(--status-warn)' }}>
          The MCP registry is unavailable ({loadError}); type an mcp:&lt;server&gt;/&lt;tool&gt; token into Applies to instead.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>When (all that are set must hold; none = always)</span>
        <div className="flex flex-wrap gap-3">
          <span className="flex flex-wrap items-center gap-2" data-testid="steering-mcp-when-roles">
            {ROLES.map((r) => (
              <label key={r} className={box} style={{ color: 'var(--ink-muted)' }}>
                <input type="checkbox" data-testid="steering-mcp-role" data-role={r} checked={when.roles.includes(r)} onChange={() => setWhen({ ...when, roles: toggle(when.roles, r) })} />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-2" data-testid="steering-mcp-when-classes">
            {CLASSES.map((c) => (
              <label key={c} className={box} style={{ color: 'var(--ink-muted)' }}>
                <input type="checkbox" data-testid="steering-mcp-class" data-class={c} checked={when.classes.includes(c)} onChange={() => setWhen({ ...when, classes: toggle(when.classes, c) })} />
                {c}
              </label>
            ))}
          </span>
          <span className="flex flex-wrap items-center gap-2" data-testid="steering-mcp-when-seats">
            {SEATS.map((s) => (
              <label key={s} className={box} style={{ color: 'var(--ink-muted)' }}>
                <input type="checkbox" data-testid="steering-mcp-seat" data-seat={s} checked={when.seats.includes(s)} onChange={() => setWhen({ ...when, seats: toggle(when.seats, s) })} />
                <span className="font-mono">{s}</span>
              </label>
            ))}
          </span>
        </div>
        <label className="flex flex-col gap-1 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
          Argument pattern (a regex over the call&rsquo;s arguments, optional)
          <input
            data-testid="steering-mcp-args"
            type="text"
            value={when.argPattern}
            spellCheck={false}
            onChange={(e) => setWhen({ ...when, argPattern: e.target.value })}
            placeholder={'e.g. "project":"PAY"'}
            className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <code data-testid="steering-mcp-compiled" className="max-w-full overflow-x-auto rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ background: 'var(--surface-base)', color: 'var(--ink-muted)' }}>
            {compiled === '' ? '(no trigger: fires on the subject alone)' : compiled}
          </code>
          <button
            type="button"
            data-testid="steering-mcp-use-when"
            disabled={issue !== null}
            onClick={() => onTrigger(compiled)}
            className="rounded px-2 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
          >
            Use as trigger
          </button>
          {issue !== null && (
            <span data-testid="steering-mcp-when-issue" className="text-[10px]" style={{ color: 'var(--status-fail)' }}>{issue}</span>
          )}
        </div>
      </div>
    </fieldset>
  );
}
