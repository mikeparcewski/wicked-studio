import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ageOf,
  canApprove,
  cellOf,
  DECISION_LABELS,
  DEFAULT_USAGE_FILTER,
  isMcpUnsupported,
  mcpApi,
  mcpPath,
  mcpUsagePath,
  MODE_LABELS,
  postureSummary,
  readMcpServerDeepLink,
  readMcpView,
  ROLE_LABELS,
  serverSubject,
  serverUsageText,
  type McpApprovalsResponse,
  type McpDecision,
  type McpPolicyPreviewResponse,
  type McpPolicyPreviewTool,
  type McpPreviewResponse,
  type McpRunMode,
  type McpServer,
  type McpServersResponse,
  type McpTool,
  type McpUpstreamKind,
  type McpUsageFilter,
  type McpUsageResponse,
  type McpView,
} from '../api/mcp.js';
import { policiesPath } from '../api/steering.js';
import { McpUsage } from './McpUsage.js';

/**
 * MCP tools (DES-MCP-TOOLS-001 §7, slice S6): the operator's registry of upstream MCP servers and
 * what the policies let each unit do with their tools. Every MCP call a worker makes goes through
 * crew's broker and the steering engine, so this page SHOWS decisions, it never makes one:
 *
 *  - **Servers**: health, auth, enabled tools, and a posture summary for the chosen run mode;
 *    expanding a row lists its tools (class, annotations, enable, Approve / Revoke) and the
 *    **Policies** matrix, one row per phase role and one column per seat, each cell the engine's
 *    own decision with the rule ids that fired (`POST /mcp/policies/preview`, recorded nowhere).
 *  - **Add existing**: paste a command or URL, preview (the tools and their decisions if saved
 *    now), then save exactly that preview (the save is bound to its `previewHash`).
 *  - Approving is an audited policy edit crew makes; the first use of any server always asks.
 *  - **Usage** (`?view=usage`, slice S7): calls, decisions split by allow / ask / deny, error rate
 *    and latency from the broker's call records; each server row also says its calls over 7 days
 *    and when it was last used.
 */

const MODES: McpRunMode[] = ['ask', 'balanced', 'autonomous'];

const DECISION_STYLE: Record<McpDecision, { color: string; background: string }> = {
  allow: { color: 'var(--status-ok)', background: 'var(--status-ok-dim)' },
  ask: { color: 'var(--status-gate)', background: 'var(--status-gate-dim)' },
  deny: { color: 'var(--status-fail)', background: 'var(--status-fail-dim)' },
};

const BORDER = '1px solid var(--surface-raised)';

type Load =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'loaded'; servers: McpServersResponse; policies: McpPolicyPreviewResponse | null; approvals: McpApprovalsResponse | null; usage: McpUsageResponse | null };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function Badge({ testid, text, style, title }: { testid?: string | undefined; text: string; style?: React.CSSProperties | undefined; title?: string | undefined }): React.ReactElement {
  return (
    <span
      data-testid={testid}
      title={title}
      className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px]"
      style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)', ...style }}
    >
      {text}
    </span>
  );
}

function DecisionChip({ decision, ruleIds, navigate }: { decision: McpDecision; ruleIds: string[]; navigate: (p: string) => void }): React.ReactElement {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        data-testid="mcp-cell-decision"
        data-decision={decision}
        className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
        style={DECISION_STYLE[decision]}
      >
        {DECISION_LABELS[decision]}
      </span>
      {ruleIds.map((id) => (
        id.startsWith('engine:') ? (
          <span key={id} data-testid="mcp-cell-rule" data-rule={id} className="font-mono text-[9px]" style={{ color: 'var(--ink-dim)' }} title="an engine gate: it holds in every mode and cannot be retired">
            {id}
          </span>
        ) : (
          <a
            key={id}
            data-testid="mcp-cell-rule"
            data-rule={id}
            href={`${policiesPath()}?rule=${encodeURIComponent(id)}`}
            onClick={(e) => { e.preventDefault(); navigate(`${policiesPath()}?rule=${encodeURIComponent(id)}`); }}
            className="font-mono text-[9px] underline"
            style={{ color: 'var(--accent)' }}
            title="open this rule in Steering"
          >
            {id}
          </a>
        )
      ))}
    </span>
  );
}

/** The Policies matrix for one tool: rows = phase roles, columns = seats, for one run mode. */
export function PolicyMatrix({ tool, roles, seats, mode, navigate }: {
  tool: McpPolicyPreviewTool;
  roles: McpPolicyPreviewResponse['roles'];
  seats: string[];
  mode: McpRunMode;
  navigate: (p: string) => void;
}): React.ReactElement {
  return (
    <div className="overflow-x-auto">
      <table data-testid="mcp-policy-matrix" data-subject={tool.subject} data-mode={mode} className="border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-semibold" style={{ color: 'var(--ink-dim)' }}>{MODE_LABELS[mode]}</th>
            {seats.map((s) => (
              <th key={s} className="px-2 py-1 text-left font-mono font-semibold" style={{ color: 'var(--ink-muted)' }}>{s}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r} data-testid="mcp-matrix-row" data-role={r} style={{ borderTop: BORDER }}>
              <td className="px-2 py-1 font-semibold" style={{ color: 'var(--ink-muted)' }}>{ROLE_LABELS[r]}</td>
              {seats.map((s) => {
                const c = cellOf(tool, r, s, mode);
                return (
                  <td key={s} data-testid="mcp-matrix-cell" data-role={r} data-seat={s} data-decision={c?.decision ?? 'none'} className="px-2 py-1 align-top">
                    {c === null ? <span style={{ color: 'var(--ink-dim)' }}>—</span> : <DecisionChip decision={c.decision} ruleIds={c.ruleIds} navigate={navigate} />}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function annotationText(t: McpTool): string {
  const a = t.annotations;
  if (a === null) return 'no annotations (counts as write)';
  const hints = (['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const)
    .filter((k) => a[k] !== undefined)
    .map((k) => `${k.replace('Hint', '')}:${String(a[k])}`);
  return hints.length > 0 ? hints.join(' ') : 'no hints (counts as write)';
}

function ToolRow({ server, tool, policy, roles, seats, mode, busy, onAct, navigate }: {
  server: McpServer;
  tool: McpTool;
  policy: McpPolicyPreviewTool | null;
  roles: McpPolicyPreviewResponse['roles'];
  seats: string[];
  mode: McpRunMode;
  busy: boolean;
  onAct: (label: string, fn: () => Promise<unknown>) => void;
  navigate: (p: string) => void;
}): React.ReactElement {
  const [showMatrix, setShowMatrix] = useState(false);
  const approvedByTool = policy !== null && (policy.approval.firstUse === 'tool' || policy.approval.write === 'tool');
  const gone = tool.status === 'gone';
  return (
    <li data-testid="mcp-tool-row" data-subject={tool.subject} data-class={tool.class} data-status={tool.status} className="flex flex-col gap-1.5 px-3 py-2" style={{ borderTop: BORDER }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px]" style={{ color: gone ? 'var(--ink-dim)' : 'var(--ink-high)' }}>{tool.name}</span>
        <Badge testid="mcp-tool-class" text={tool.class} style={tool.class === 'read' ? undefined : { color: 'var(--status-warn)' }} title={tool.classOverride !== null ? `operator override (derived: ${tool.derivedClass})` : 'derived from its own annotations'} />
        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{annotationText(tool)}</span>
        {tool.status !== 'registered' && (
          <Badge testid="mcp-tool-status" text={tool.status} style={{ color: 'var(--status-fail)' }} title={tool.status === 'gone' ? 'the server no longer lists it' : 'its schema changed since the save: denied until previewed and saved again'} />
        )}
        {policy !== null && (policy.approval.firstUse !== null || policy.approval.write !== null) && (
          <Badge
            testid="mcp-tool-approval"
            text={`approved: ${[policy.approval.firstUse !== null ? `first use (${policy.approval.firstUse})` : null, policy.approval.write !== null ? `writes (${policy.approval.write})` : null].filter(Boolean).join(', ')}`}
            style={{ color: 'var(--status-ok)' }}
          />
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {!gone && (
            <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink-muted)' }} title={tool.enabled ? 'Disable: calls to this tool are refused from the next call' : 'Enable: the tool is judged by policy again'}>
              <input
                data-testid="mcp-tool-enabled"
                type="checkbox"
                checked={tool.enabled}
                disabled={busy}
                onChange={(e) => onAct(`${e.target.checked ? 'Enabled' : 'Disabled'} ${tool.subject}`, () => mcpApi.setTool(tool.subject, { enabled: e.target.checked }))}
              />
              enabled
            </label>
          )}
          {policy !== null && canApprove(policy) && !approvedByTool && (
            <button
              type="button"
              data-testid="mcp-tool-approve"
              disabled={busy}
              onClick={() => onAct(`Approved ${tool.subject}`, () => mcpApi.approve(tool.subject))}
              className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              title="An audited policy edit: this tool's first use and its writes stop asking in balanced mode. Deny rules and the evaluator gate still hold."
            >
              Approve tool
            </button>
          )}
          {approvedByTool && (
            <button
              type="button"
              data-testid="mcp-tool-revoke"
              disabled={busy}
              onClick={() => onAct(`Revoked ${tool.subject}`, () => mcpApi.revoke(tool.subject))}
              className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40"
              style={{ color: 'var(--status-fail)', border: BORDER }}
              title="Its next call asks again"
            >
              Revoke
            </button>
          )}
          {policy !== null && (
            <button
              type="button"
              data-testid="mcp-tool-policies"
              aria-expanded={showMatrix}
              onClick={() => setShowMatrix((v) => !v)}
              className="rounded px-2 py-0.5 text-[10px] font-semibold"
              style={{ color: 'var(--accent)', border: BORDER }}
            >
              {showMatrix ? 'Hide policies' : 'Policies'}
            </button>
          )}
        </span>
      </div>
      {tool.description !== null && tool.description !== '' && (
        <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{tool.description}</p>
      )}
      {showMatrix && policy !== null && <PolicyMatrix tool={policy} roles={roles} seats={seats} mode={mode} navigate={navigate} />}
      {server.enabled === false && <p className="text-[10px]" style={{ color: 'var(--status-warn)' }}>The server is disabled: every call is denied.</p>}
    </li>
  );
}

function ServerRow({ server, policies, usage, open, onToggle, mode, busy, onAct, navigate }: {
  server: McpServer;
  policies: McpPolicyPreviewResponse | null;
  /** The 7-day usage fold; `null` = this daemon does not report usage. */
  usage: McpUsageResponse | null;
  open: boolean;
  onToggle: () => void;
  mode: McpRunMode;
  busy: boolean;
  onAct: (label: string, fn: () => Promise<unknown>) => void;
  navigate: (p: string) => void;
}): React.ReactElement {
  const mine = policies?.tools.filter((t) => t.server === server.name) ?? [];
  const summary = postureSummary(mine, mode);
  const serverApproved = mine.some((t) => t.approval.firstUse === 'server');
  const needsFirstUse = mine.some((t) => t.registered && t.approval.firstUse === null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const health = server.health;
  const live = server.tools.filter((t) => t.status !== 'gone');
  return (
    <li data-testid="mcp-server-row" data-server={server.name} data-open={open} className="rounded" style={{ border: BORDER, background: 'var(--surface-card)' }}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" data-testid="mcp-server-toggle" aria-expanded={open} onClick={onToggle} className="flex items-center gap-2 text-left">
          <span aria-hidden style={{ color: 'var(--ink-dim)', transform: open ? 'rotate(90deg)' : 'none', display: 'inline-block' }}>›</span>
          <span className="font-mono text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>{server.name}</span>
        </button>
        <Badge text={server.kind} />
        <Badge
          testid="mcp-server-health"
          text={`health ${health.state} · ${ageOf(health.checkedAt)}`}
          style={{ color: health.state === 'ok' ? 'var(--status-ok)' : health.state === 'failing' ? 'var(--status-fail)' : 'var(--ink-dim)' }}
          title={health.lastError ?? undefined}
        />
        <Badge testid="mcp-server-auth" text={`auth ${server.authState}`} style={server.authState === 'missing' ? { color: 'var(--status-fail)' } : undefined} />
        <Badge testid="mcp-server-tools" text={`${server.counts.enabled}/${server.counts.total} tools enabled`} />
        {!server.enabled && <Badge text="disabled" style={{ color: 'var(--status-fail)' }} />}
        {usage !== null && (() => {
          const u = usage.servers.find((x) => x.server === server.name);
          return <Badge testid="mcp-server-usage" text={serverUsageText(u, usage.days)} title={u === undefined ? undefined : `${u.decisions.allow} allowed · ${u.decisions.ask} asked · ${u.decisions.deny} denied · ${u.decisions.guard_error} guard errors`} />;
        })()}
        <span data-testid="mcp-server-posture" data-allow={summary.allow} data-ask={summary.ask} data-deny={summary.deny} className="text-[10px]" style={{ color: 'var(--ink-muted)' }} title={`what a creator unit gets in ${MODE_LABELS[mode]} mode`}>
          {policies === null ? 'posture unavailable' : summary.text}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {needsFirstUse && !serverApproved && (
            <button
              type="button"
              data-testid="mcp-server-approve"
              disabled={busy}
              onClick={() => onAct(`Approved the first use of ${server.name}`, () => mcpApi.approve(serverSubject(server.name)))}
              className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
              title="An audited policy edit: the server's first use stops asking. Its write tools still ask in Gate by risk until each is approved."
            >
              Approve first use
            </button>
          )}
          {serverApproved && (
            <button
              type="button"
              data-testid="mcp-server-revoke"
              disabled={busy}
              onClick={() => onAct(`Revoked ${server.name}`, () => mcpApi.revoke(serverSubject(server.name)))}
              className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40"
              style={{ color: 'var(--status-fail)', border: BORDER }}
              title="Every tool's next call asks for first use again"
            >
              Revoke server
            </button>
          )}
          <button
            type="button"
            data-testid="mcp-server-test"
            disabled={busy}
            onClick={() => onAct(`Tested ${server.name}`, () => mcpApi.test(server.name))}
            className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40"
            style={{ color: 'var(--accent)', border: BORDER }}
            title="Probe the server now and diff its tools against the saved ones; a changed tool is denied until saved again"
          >
            Test
          </button>
          {confirmRemove ? (
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--status-fail)' }}>
              <span data-testid="mcp-server-remove-consequence">
                Removes {live.length} tool{live.length === 1 ? '' : 's'} and withdraws their approvals; calls are refused from the next call.
              </span>
              <button type="button" data-testid="mcp-server-remove-confirm" disabled={busy} onClick={() => { setConfirmRemove(false); onAct(`Removed ${server.name}`, () => mcpApi.remove(server.name)); }} className="rounded px-2 py-0.5 font-semibold" style={{ background: 'var(--status-fail)', color: 'var(--accent-fg)' }}>
                Remove
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="px-1 hover:underline" style={{ color: 'var(--ink-dim)' }}>Keep</button>
            </span>
          ) : (
            <button type="button" data-testid="mcp-server-remove" disabled={busy} onClick={() => setConfirmRemove(true)} className="rounded px-2 py-0.5 text-[10px] disabled:opacity-40" style={{ color: 'var(--ink-dim)', border: BORDER }}>
              Remove…
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="flex flex-col pb-1">
          <p className="px-3 pb-1 font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            {server.kind === 'mcp-stdio' ? `${server.command ?? ''} ${server.args.join(' ')}` : server.url}
            {server.auth !== null && ` · secret ${server.auth.ref}`}
          </p>
          <ul>
            {server.tools.map((t) => (
              <ToolRow
                key={t.name}
                server={server}
                tool={t}
                policy={policies?.tools.find((p) => p.subject === t.subject) ?? null}
                roles={policies?.roles ?? []}
                seats={policies?.seats ?? []}
                mode={mode}
                busy={busy}
                onAct={onAct}
                navigate={navigate}
              />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Add existing / Wrap an API: paste a command or URL (or a REST API's base URL and its OpenAPI URL)
 * → preview (tools + decisions if saved now) → save that preview.
 */
/**
 * What a typed header scheme sends. The broker builds the header as `${prefix}${secret}`, and a
 * scheme is separated from its credential by ONE space — but a trailing space in a text box is
 * invisible, so typing the natural `Bearer` would send `Bearertoken` and the API would still 401
 * (codex review round 4 on #387). A scheme is therefore trimmed and given exactly one space,
 * unless it ends in a separator that takes none (`token=abc`, `x:abc`).
 */
export function schemePrefix(raw: string): string {
  const scheme = raw.trim();
  if (scheme === '') return '';
  return /[=:]$/.test(scheme) ? scheme : `${scheme} `;
}

function AddServerPanel({ onSaved, onClose, mode, navigate, saved }: {
  onSaved: (name: string) => void;
  onClose: () => void;
  mode: McpRunMode;
  navigate: (p: string) => void;
  /** The servers already registered — a pasted secret for one of these REPLACES its live
   *  credential, which its running calls use from the next call, so it needs consent. */
  saved: ReadonlyArray<string>;
}): React.ReactElement {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<McpUpstreamKind>('mcp-stdio');
  const [target, setTarget] = useState('');
  /** `rest` only: where crew fetches the API's OpenAPI document. */
  const [openapiUrl, setOpenapiUrl] = useState('');
  const [authRef, setAuthRef] = useState('');
  const [authEnv, setAuthEnv] = useState('');
  /**
   * The scheme a header-injected secret rides behind (`McpAuthConfig.prefix`, honoured by the
   * broker as `${prefix}${secret}`). Without it every `Authorization: Bearer <token>` API was
   * sent the bare token and answered 401.
   */
  const [authPrefix, setAuthPrefix] = useState('');
  /**
   * A pasted secret VALUE (§7: "Paste a command, URL or OpenAPI URL and a secret"). It STAYS in
   * this form and rides the preview body (`secret`, wicked-crew#719): crew probes with it and
   * writes it to the OS keychain as part of the save, so the secret and the registry row commit
   * together. It used to be written by `PUT /mcp/servers/:name/secret` BEFORE the preview — which
   * is what left a keychain entry with no server whenever the save never happened.
   */
  const [authValue, setAuthValue] = useState('');
  const [replaceOk, setReplaceOk] = useState(false);
  /** The preview, bound to the exact request it answered (`key`): only shown and saved while the
   *  form still says the same thing, so a late answer to an older request can never be saved. */
  const [held, setHeld] = useState<{ key: string; preview: McpPreviewResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameOk = /^[a-z0-9_-]{1,63}$/.test(name);
  /** A pasted secret for a name already registered overwrites THAT server's live credential. */
  const replacesLiveSecret = authValue !== '' && saved.includes(name);
  const ready = nameOk && target.trim() !== '' && (kind !== 'rest' || openapiUrl.trim() !== '')
    // A pasted value decides the reference (crew answers it), so a half-typed reference must not
    // block the secret that replaces it (codex review round 6 on #387).
    && (authValue !== '' || authRef.trim() === '' || /^(env|keychain):/.test(authRef.trim()))
    && (!replacesLiveSecret || replaceOk);

  /** (crew#719) The keychain entry a pasted value goes into: this server's own. Studio names it up
   *  front — it is derivable — instead of learning it from a pre-write it no longer makes. */
  const impliedRef = (): string => (authValue !== '' ? `keychain:wicked-mcp/${name}` : authRef.trim());

  /** The request for one secret reference — the state's, or the one a pasted value implies. */
  const bodyWith = (ref: string) => {
    const parts = target.trim().split(/\s+/);
    const into = authEnv.trim() !== '' ? (kind === 'mcp-stdio' ? { env: authEnv.trim() } : { header: authEnv.trim() }) : {};
    // A prefix belongs to a HEADER injection only; an env-injected secret is the value itself.
    const scheme = kind !== 'mcp-stdio' && authPrefix.trim() !== '' ? { prefix: schemePrefix(authPrefix) } : {};
    const auth = ref === '' ? null : { ref, ...into, ...scheme };
    if (kind === 'mcp-stdio') return { name, kind, command: parts[0] ?? '', args: parts.slice(1), auth };
    if (kind === 'rest') return { name, kind, url: target.trim(), openapiUrl: openapiUrl.trim(), auth };
    return { name, kind, url: target.trim(), auth };
  };
  const body = () => bodyWith(impliedRef());

  const previewSeq = useRef(0);
  const formKey = JSON.stringify(body());
  /** The LIVE form key, readable after an await (the closure's copy is the one it started with). */
  const formKeyRef = useRef(formKey);
  formKeyRef.current = formKey;
  /** The LIVE secret value. It is deliberately NOT in `formKey`: the key identifies the server
   *  being asked about, and a late answer must not be shown for another one. */
  const authValueRef = useRef(authValue);
  authValueRef.current = authValue;
  const preview = held !== null && held.key === formKey ? held.preview : null;
  /** Any edit drops the held preview AND the last failure: neither speaks for the form now. */
  const setPreview = (p: null): void => { setHeld(p); setError(null); };

  const doPreview = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setHeld(null);
    const seq = ++previewSeq.current;
    // What the operator asked about. The form stays editable while this runs (a late answer is
    // dropped by key, not by freezing the form), so anything written back after an await must
    // check that the form still says the same thing.
    //
    // (crew#719) ONE request now: the secret is STAGED with the preview, and crew writes it to the
    // keychain only when the save commits. Nothing is written before the operator saves, so this
    // no longer re-points `asked` half way through — and the two-step it replaces is exactly what
    // could leave a keychain entry with no server.
    const asked = formKey;
    const askedValue = authValue;
    const stillMine = (): boolean =>
      seq === previewSeq.current && formKeyRef.current === asked && authValueRef.current === askedValue;
    try {
      const answer = await mcpApi.preview({
        ...(JSON.parse(asked) as ReturnType<typeof body>),
        // The value never enters `formKey`, so it is added here, at the send.
        ...(askedValue !== '' ? { secret: askedValue } : {}),
      });
      if (seq === previewSeq.current) setHeld({ key: asked, preview: answer });
    } catch (e) {
      // A rejection belongs to the form it was asked about (codex review round 3 on #387): "a
      // secret is at least 8 characters" must not land on a form whose secret the operator has
      // already lengthened, or on another server entirely.
      if (stillMine()) setError(msg(e));
    } finally {
      if (seq === previewSeq.current) setBusy(false);
    }
  };

  const doSave = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await mcpApi.save(preview.previewHash);
      onSaved(saved.name);
    } catch (e) {
      setError(msg(e));
      setBusy(false);
    }
  };

  const input = 'rounded px-2 py-1 font-mono text-[11px] focus:outline-none';
  const inputStyle: React.CSSProperties = { background: 'var(--surface-base)', border: BORDER, color: 'var(--ink-high)' };
  const pol = preview?.policies ?? null;
  return (
    <section data-testid="mcp-add-panel" className="flex flex-col gap-2 rounded p-3" style={{ border: BORDER, background: 'var(--surface-rail)' }}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>{kind === 'rest' ? 'Wrap a REST API' : 'Add an existing MCP server'}</h3>
        <button type="button" data-testid="mcp-add-cancel" onClick={onClose} className="ml-auto text-[10px] hover:underline" style={{ color: 'var(--ink-dim)' }}>Cancel</button>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        Crew probes the server, lists its tools and shows what each unit would get under your policies. Nothing is registered until you save that exact preview.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Name
          <input data-testid="mcp-add-name" value={name} onChange={(e) => { setName(e.target.value); setReplaceOk(false); setPreview(null); }} placeholder="jira" spellCheck={false} className={`${input} w-32`} style={{ ...inputStyle, borderColor: name === '' || nameOk ? undefined : 'var(--status-fail)' }} />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Kind
          <select data-testid="mcp-add-kind" value={kind} onChange={(e) => { setKind(e.target.value as McpUpstreamKind); setPreview(null); }} className={input} style={inputStyle}>
            <option value="mcp-stdio">stdio command</option>
            <option value="mcp-http">http URL</option>
            <option value="rest">REST API (OpenAPI)</option>
          </select>
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {kind === 'mcp-stdio' ? 'Command (with its arguments)' : kind === 'rest' ? 'Base URL (every call is pinned to it)' : 'URL'}
          <input data-testid="mcp-add-target" value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }} placeholder={kind === 'mcp-stdio' ? 'npx -y @acme/jira-mcp' : kind === 'rest' ? 'https://api.example.com/v1' : 'https://mcp.example.com/mcp'} spellCheck={false} className={input} style={inputStyle} />
        </label>
        {kind === 'rest' && (
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            OpenAPI document URL
            <input data-testid="mcp-add-openapi-url" value={openapiUrl} onChange={(e) => { setOpenapiUrl(e.target.value); setPreview(null); }} placeholder="https://api.example.com/openapi.json" spellCheck={false} className={input} style={inputStyle} />
          </label>
        )}
      </div>
      {kind === 'rest' && (
        <p data-testid="mcp-add-rest-note" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Each operation becomes a tool: GET reads, POST writes, PUT, PATCH and DELETE are destructive. A call sends only the arguments its operation declares, and only to the base URL; a request or redirect that would leave it is refused and recorded.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Secret reference (optional)
          <input data-testid="mcp-add-auth-ref" value={authRef} onChange={(e) => { setAuthRef(e.target.value); setPreview(null); }} placeholder="env:JIRA_TOKEN" spellCheck={false} className={`${input} w-48`} style={inputStyle} />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Secret value (optional)
          <input
            data-testid="mcp-add-auth-value"
            type="password"
            autoComplete="off"
            value={authValue}
            onChange={(e) => { setAuthValue(e.target.value); setReplaceOk(false); setPreview(null); }}
            placeholder="paste it once"
            spellCheck={false}
            className={`${input} w-44`}
            style={inputStyle}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          {kind === 'mcp-stdio' ? 'Injected as env var' : 'Injected as header'}
          <input data-testid="mcp-add-auth-into" value={authEnv} onChange={(e) => { setAuthEnv(e.target.value); setPreview(null); }} placeholder={kind === 'mcp-stdio' ? 'JIRA_TOKEN' : 'Authorization'} spellCheck={false} className={`${input} w-40`} style={inputStyle} />
        </label>
        {kind !== 'mcp-stdio' && (
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Behind scheme
            <input data-testid="mcp-add-auth-prefix" value={authPrefix} onChange={(e) => { setAuthPrefix(e.target.value); setPreview(null); }} placeholder="Bearer" spellCheck={false} className={`${input} w-28`} style={inputStyle} />
          </label>
        )}
        {kind !== 'mcp-stdio' && authEnv.trim() !== '' && (
          // The header as it will be sent, spacing included — a trailing space is invisible in
          // the box, and `Bearertoken` 401s exactly like no header at all.
          <p data-testid="mcp-add-auth-shape" className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            {authEnv.trim()}: {schemePrefix(authPrefix)}&lt;the secret&gt;
          </p>
        )}
        <p className="max-w-[22rem] text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          A pasted value is probed with, then written to the OS keychain when you SAVE — together with the server, so neither can land without the other. The registry keeps the reference only. The broker resolves it on each call, sends it {kind === 'mcp-stdio' ? 'in that env var' : 'in that header behind that scheme'}, and no worker ever sees the value.
        </p>
        <button type="button" data-testid="mcp-add-preview" disabled={!ready || busy} onClick={() => void doPreview()} className="ml-auto rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40" style={{ color: 'var(--accent)', border: BORDER }}>
          {busy && preview === null ? 'Probing…' : 'Preview'}
        </button>
      </div>
      {replacesLiveSecret && (
        // The consent line said "Previewing writes this secret over the one X uses now", which was
        // true of the pre-write ordering crew#719 removed. Saving is now the one write, and the
        // effect on a LIVE server is the same either way: its next call uses the new value.
        <label data-testid="mcp-add-replace-secret" className="flex items-start gap-2 rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}>
          <input type="checkbox" data-testid="mcp-add-replace-secret-ok" checked={replaceOk} onChange={(e) => setReplaceOk(e.target.checked)} />
          <span>
            {name} is already registered. Saving writes this secret over the one {name} uses now — its
            next call, and any run in flight, uses the new value. The old value cannot be recovered.
            Previewing only probes with it; nothing is written until you save.
          </span>
        </label>
      )}
      {error !== null && (
        <p data-testid="mcp-add-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>{error}</p>
      )}
      {preview !== null && (
        <div data-testid="mcp-add-preview-result" data-preview-hash={preview.previewHash} className="flex flex-col gap-2">
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            {preview.serverInfo !== null ? `${preview.serverInfo.name} ${preview.serverInfo.version} · ` : ''}
            {preview.tools.length} tool{preview.tools.length === 1 ? '' : 's'}
            {preview.diff !== null && ` · replaces the saved ${name}: ${preview.diff.added.length} added, ${preview.diff.changed.length} changed, ${preview.diff.removed.length} removed`}
          </p>
          {preview.skipped !== undefined && preview.skipped.length > 0 && (
            <p data-testid="mcp-add-skipped" className="text-[10px]" style={{ color: 'var(--status-warn)' }}>
              Not wrapped: {preview.skipped.join('; ')}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button type="button" data-testid="mcp-add-save" disabled={busy} onClick={() => void doSave()} className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
              {busy ? 'Saving…' : `Save ${preview.tools.length} tool${preview.tools.length === 1 ? '' : 's'}`}
            </button>
            <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              Registers exactly this preview (it expires {ageOf(preview.expiresAt) === 'just now' ? 'soon' : `at ${new Date(preview.expiresAt).toLocaleTimeString()}`}). The first use of the server asks until you approve it.
            </span>
          </div>
          {pol === null ? (
            <p data-testid="mcp-add-no-matrix" className="text-[10px]" style={{ color: 'var(--status-warn)' }}>This daemon cannot preview decisions; each call is still judged by policy once saved.</p>
          ) : (
            <>
              {pol.withdrawOnSave.length > 0 && (
                <p data-testid="mcp-add-withdraw" className="text-[10px]" style={{ color: 'var(--status-warn)' }}>
                  Saving withdraws these approvals, because a tool&rsquo;s schema changed: {pol.withdrawOnSave.join(', ')}. Their next call asks again.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {pol.tools.map((t) => (
                  <li key={t.subject} data-testid="mcp-add-preview-tool" data-subject={t.subject} data-class={t.class} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[11px]" style={{ color: 'var(--ink-high)' }}>{t.tool}</span>
                      <Badge text={t.class} style={t.class === 'read' ? undefined : { color: 'var(--status-warn)' }} />
                    </span>
                    <PolicyMatrix tool={t} roles={pol.roles} seats={pol.seats} mode={mode} navigate={navigate} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function McpToolsPage({ navigate, search }: { navigate: (p: string) => void; search: string }): React.ReactElement {
  const [state, setState] = useState<Load>({ kind: 'loading' });
  const [mode, setMode] = useState<McpRunMode>('balanced');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const deepLinked = readMcpServerDeepLink(search);
  const view: McpView = readMcpView(search);
  const [usageFilter, setUsageFilter] = useState<McpUsageFilter>(DEFAULT_USAGE_FILTER);
  const [openServers, setOpenServers] = useState<Set<string>>(() => new Set(deepLinked !== null ? [deepLinked] : []));

  // Only the latest load may land: an older, slower answer never overwrites a newer one.
  const loadSeq = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current;
    try {
      const servers = await mcpApi.servers();
      // The matrix and the approvals are S6; a daemon with the registry but not them still lists servers.
      // Usage is S7: a daemon without it still lists servers, without the usage line.
      const [policies, approvals, usage] = await Promise.all([
        mcpApi.policies({}).catch(() => null),
        mcpApi.approvals().catch(() => null),
        mcpApi.usage(DEFAULT_USAGE_FILTER).catch(() => null),
      ]);
      if (seq !== loadSeq.current) return;
      setState({ kind: 'loaded', servers, policies, approvals, usage });
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setState(isMcpUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', message: msg(e) });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (deepLinked !== null) setOpenServers((cur) => new Set([...cur, deepLinked]));
  }, [deepLinked]);

  const onAct = useCallback((label: string, fn: () => Promise<unknown>): void => {
    setBusy(true);
    setNote(null);
    void fn()
      .then(() => setNote({ ok: true, text: `${label}.` }))
      .catch((e: unknown) => setNote({ ok: false, text: `${label} failed: ${msg(e)}` }))
      // Actions stay disabled until the server's answer is on screen, so no control acts on the
      // pre-action state.
      .finally(() => { void load().finally(() => setBusy(false)); });
  }, [load]);

  const loaded = state.kind === 'loaded' ? state : null;
  const pending = loaded?.approvals?.pending;
  const pendingWrites = (pending ?? []).filter((p) => p.needs.includes('write')).length;
  const pendingFirst = useMemo(() => new Set((pending ?? []).filter((p) => p.needs.includes('first-use')).map((p) => p.server)).size, [pending]);

  return (
    <div data-testid="mcp-tools-page" className="flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <div className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1 basis-[16rem]">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>MCP tools</h2>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
              The MCP servers your governed workers may call, through crew&rsquo;s broker on every seat. Each call is judged by
              your Steering policies and recorded; the first use of a server always asks, then the run&rsquo;s mode decides.
              Evaluator phases never call write tools, and secrets never leave the broker.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {view === 'servers' && <div role="radiogroup" aria-label="Show decisions for run mode" data-testid="mcp-mode" className="flex gap-1">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  data-testid="mcp-mode-option"
                  data-mode={m}
                  onClick={() => setMode(m)}
                  className="rounded px-2 py-1 text-[11px] font-semibold"
                  style={{ background: mode === m ? 'var(--surface-raised)' : 'transparent', color: mode === m ? 'var(--ink-high)' : 'var(--ink-muted)', border: BORDER }}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>}
            <a
              data-testid="mcp-steering-link"
              href={`${policiesPath()}?mcp=1`}
              onClick={(e) => { e.preventDefault(); navigate(`${policiesPath()}?mcp=1`); }}
              className="rounded px-2 py-1 text-[11px] font-semibold"
              style={{ color: 'var(--accent)', border: BORDER }}
            >
              MCP policies
            </a>
            {view === 'servers' && loaded !== null && !adding && (
              <button type="button" data-testid="mcp-add-open" onClick={() => setAdding(true)} className="rounded px-2 py-1 text-[11px] font-semibold" style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
                Add existing server
              </button>
            )}
          </div>
        </div>

        <div role="tablist" aria-label="MCP tools view" data-testid="mcp-view" className="flex gap-1" style={{ borderBottom: BORDER }}>
          {(['servers', 'usage'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              data-testid="mcp-view-tab"
              data-view={v}
              onClick={() => navigate(v === 'usage' ? mcpUsagePath() : mcpPath())}
              className="-mb-px px-3 py-1.5 text-[11px] font-semibold"
              style={{ color: view === v ? 'var(--ink-high)' : 'var(--ink-muted)', borderBottom: view === v ? '2px solid var(--accent)' : '2px solid transparent' }}
            >
              {v === 'servers' ? 'Servers' : 'Usage'}
            </button>
          ))}
        </div>

        {view === 'usage' && <McpUsage navigate={navigate} filter={usageFilter} onFilter={setUsageFilter} />}

        {view === 'servers' && state.kind === 'loading' && <p data-testid="mcp-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading MCP servers…</p>}
        {view === 'servers' && state.kind === 'unsupported' && (
          <p data-testid="mcp-unsupported" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--surface-rail)', border: BORDER, color: 'var(--ink-muted)' }}>
            This wicked-crew daemon has no MCP tools registry yet. Upgrade wicked-crew to register servers here.
          </p>
        )}
        {view === 'servers' && state.kind === 'failed' && (
          <p data-testid="mcp-error" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>{state.message}</p>
        )}

        {view === 'servers' && note !== null && (
          <p data-testid="mcp-note" data-ok={note.ok} className="rounded px-3 py-2 text-[11px]" style={note.ok ? { background: 'var(--surface-rail)', border: BORDER, color: 'var(--ink-muted)' } : { background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {note.text}
          </p>
        )}

        {view === 'servers' && loaded !== null && adding && (
          <AddServerPanel
            mode={mode}
            navigate={navigate}
            saved={loaded.servers.servers.map((sv) => sv.name)}
            onClose={() => setAdding(false)}
            onSaved={(name) => {
              setAdding(false);
              setNote({ ok: true, text: `Saved ${name}. Its first use asks until you approve it.` });
              setOpenServers((cur) => new Set([...cur, name]));
              void load();
            }}
          />
        )}

        {view === 'servers' && loaded !== null && (
          <>
            {(pendingFirst > 0 || pendingWrites > 0) && (
              <p data-testid="mcp-pending" data-first-use={pendingFirst} data-write={pendingWrites} className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}>
                {pendingFirst > 0 && `${pendingFirst} server${pendingFirst === 1 ? '' : 's'} not yet approved for first use`}
                {pendingFirst > 0 && pendingWrites > 0 && ' · '}
                {pendingWrites > 0 && `${pendingWrites} write tool${pendingWrites === 1 ? '' : 's'} ask in Gate by risk`}
                . A call that asks does not run; approve it here.
              </p>
            )}
            {loaded.policies === null && loaded.servers.servers.length > 0 && (
              <p data-testid="mcp-no-policies" className="text-[10px]" style={{ color: 'var(--status-warn)' }}>
                This daemon cannot preview policy decisions or approvals; upgrade wicked-crew for the Policies matrix.
              </p>
            )}
            {loaded.servers.servers.length === 0 ? (
              <p data-testid="mcp-empty" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--surface-rail)', border: BORDER, color: 'var(--ink-muted)' }}>
                No MCP servers registered. Add an existing server to let governed workers call its tools.
              </p>
            ) : (
              <ul data-testid="mcp-servers" className="flex flex-col gap-2">
                {loaded.servers.servers.map((s) => (
                  <ServerRow
                    key={s.name}
                    server={s}
                    policies={loaded.policies}
                    usage={loaded.usage}
                    open={openServers.has(s.name)}
                    onToggle={() => {
                      setOpenServers((cur) => {
                        const next = new Set(cur);
                        if (next.has(s.name)) next.delete(s.name); else next.add(s.name);
                        return next;
                      });
                    }}
                    mode={mode}
                    busy={busy}
                    onAct={onAct}
                    navigate={navigate}
                  />
                ))}
              </ul>
            )}

            {loaded.servers.discovered.length > 0 && (
              <section data-testid="mcp-discovered" className="flex flex-col gap-1">
                <h3 className="text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Discovered, not managed</h3>
                <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
                  Servers configured in a CLI&rsquo;s own home, by name only. A server in a worker home is flagged: governed workers load no ambient MCP, and a call to it is denied.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {loaded.servers.discovered.map((d) => (
                    <li key={`${d.cli}-${d.origin}-${d.name}`}>
                      <Badge
                        testid="mcp-discovered-server"
                        text={`${d.name} · ${d.cli}${d.origin === 'worker' ? ' · worker home' : ''}${d.managed ? ' · managed' : ''}`}
                        style={d.origin === 'worker' ? { color: 'var(--status-fail)', background: 'var(--status-fail-dim)' } : undefined}
                        title={d.source}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
