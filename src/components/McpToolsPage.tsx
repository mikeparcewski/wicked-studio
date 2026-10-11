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
import { PageFrame, SectionTitle } from './ui/PageFrame.js';
import { Segmented } from './ui/Segmented.js';
import { Switch } from './ui/Switch.js';
import { TechDetails } from './ui/TechDetails.js';
import { StateBanner, EmptyState, Skeleton } from './ui/StateBanner.js';
import { readErrorKind } from '../api/errors.js';
import { seatLabel } from '../board/seatNames.js';
import { OverflowMenu } from './ui/OverflowMenu.js';
import { Tabs } from './ui/Tabs.js';

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

type Load =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string; errorKind: ReturnType<typeof readErrorKind> }
  | { kind: 'loaded'; servers: McpServersResponse; policies: McpPolicyPreviewResponse | null; approvals: McpApprovalsResponse | null; usage: McpUsageResponse | null };

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function Badge({ testid, text, style, title }: { testid?: string | undefined; text: string; style?: React.CSSProperties | undefined; title?: string | undefined }): React.ReactElement {
  return (
    <span
      data-testid={testid}
      title={title}
      className="wk-tag"
      style={style}
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
        className="wk-tag"
        style={DECISION_STYLE[decision]}
      >
        {DECISION_LABELS[decision]}
      </span>
      {ruleIds.map((id) => (
        id.startsWith('engine:') ? (
          <span key={id} data-testid="mcp-cell-rule" data-rule={id} className="" style={{ color: 'var(--ink-dim)' }} title="an engine gate: it holds in every mode and cannot be retired">
            <TechDetails text={id} />
          </span>
        ) : (
          <a
            key={id}
            data-testid="mcp-cell-rule"
            data-rule={id}
            href={`${policiesPath()}?rule=${encodeURIComponent(id)}`}
            onClick={(e) => { e.preventDefault(); navigate(`${policiesPath()}?rule=${encodeURIComponent(id)}`); }}
            className="wk-link"

            title="open this rule in Steering"
          >
            View rule
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
      <table data-testid="mcp-policy-matrix" data-subject={tool.subject} data-mode={mode} className="border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-semibold" style={{ color: 'var(--ink-dim)' }}>{MODE_LABELS[mode]}</th>
            {seats.filter(s => !/agy|antigravity/i.test(s)).map((s) => (
              <th key={s} className="px-2 py-1 text-left font-semibold" style={{ color: 'var(--ink-muted)' }}>{seatLabel({key:s})}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r} data-testid="mcp-matrix-row" data-role={r} >
              <td className="px-2 py-1 font-semibold" style={{ color: 'var(--ink-muted)' }}>{r === 'creator' ? 'Build' : r === 'evaluator' ? 'Review' : 'Explore'}</td>
              {seats.filter(s => !/agy|antigravity/i.test(s)).map((s) => {
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
    <li data-testid="mcp-tool-row" data-subject={tool.subject} data-class={tool.class} data-status={tool.status} className="wk-list-row wk-pg-mcp-tool" >
      <div className="flex flex-wrap items-center gap-2">
        <span className="" style={{ color: gone ? 'var(--ink-dim)' : 'var(--ink-high)'  }}>{tool.name}</span>
        <Badge testid="mcp-tool-class" text={tool.class} style={{ color: 'var(--status-warn)' }} title={tool.classOverride !== null ? `operator override (derived: ${tool.derivedClass})` : 'derived from its own annotations'} />
        <TechDetails text={annotationText(tool)} />
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
            <Switch data-testid="mcp-tool-enabled" label="Tool enabled" checked={tool.enabled} disabled={busy ? 'Wait for the current change to finish.' : null}
              onChange={(enabled) => onAct(`${enabled ? 'Enabled' : 'Disabled'} ${tool.name}`, () => mcpApi.setTool(tool.subject, {enabled}))} />
          )}
          <span data-testid={approvedByTool ? 'mcp-tool-revoke' : policy !== null && canApprove(policy) ? 'mcp-tool-approve' : undefined} data-disabled={busy}>
            <span data-testid={policy !== null ? 'mcp-tool-policies' : undefined}>
              <OverflowMenu label={`More actions for ${tool.name}`} items={[
                ...(policy !== null && canApprove(policy) && !approvedByTool ? [{id:'approve',label:'Approve tool',disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => onAct(`Approved ${tool.name}`, () => mcpApi.approve(tool.subject))}] : []),
                ...(approvedByTool ? [{id:'revoke',label:'Revoke',danger:true,disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => onAct(`Revoked ${tool.name}`, () => mcpApi.revoke(tool.subject))}] : []),
                ...(policy !== null ? [{id:'policies',label:showMatrix ? 'Hide policies' : 'Policies',onSelect:() => setShowMatrix(v => !v)}] : []),
              ]} />
            </span>
          </span>
        </span>
      </div>
      {tool.description !== null && tool.description !== '' && (
        <p className="" style={{ color: 'var(--ink-dim)' }}>{tool.description}</p>
      )}
      {showMatrix && policy !== null && <PolicyMatrix tool={policy} roles={roles} seats={seats} mode={mode} navigate={navigate} />}
      {server.enabled === false && <p className="" style={{ color: 'var(--status-warn)' }}>The server is disabled: every call is denied.</p>}
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
    <li data-testid="mcp-server-row" data-server={server.name} data-open={open} className="wk-card wk-pg-mcp-server" >
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <button type="button" data-testid="mcp-server-toggle" aria-expanded={open} onClick={onToggle} className="wk-btn wk-btn--secondary">
          <span aria-hidden style={{ color: 'var(--ink-dim)' }}>›</span>
          <span className="font-semibold" style={{ color: 'var(--ink-high)' }}>{server.name}</span>
        </button>
        <Badge text={server.kind} />
        <Badge
          testid="mcp-server-health"
          text={`health ${health.state} · ${ageOf(health.checkedAt)}`}
          style={{ color: health.state === 'ok' ? 'var(--status-ok)' : health.state === 'failing' ? 'var(--status-fail)' : 'var(--ink-dim)'  }}
          title="Latest service check"
        />
        <Badge testid="mcp-server-auth" text={`auth ${server.authState}`} style={{ color: 'var(--status-fail)' }} />
        <Badge testid="mcp-server-tools" text={`${server.counts.enabled}/${server.counts.total} tools enabled`} />
        {!server.enabled && <Badge text="disabled" style={{ color: 'var(--status-fail)' }} />}
        {usage !== null && (() => {
          const u = usage.servers.find((x) => x.server === server.name);
          return <Badge testid="mcp-server-usage" text={serverUsageText(u, usage.days)} title={u === undefined ? undefined : `${u.decisions.allow} allowed · ${u.decisions.ask} asked · ${u.decisions.deny} denied · ${u.decisions.guard_error} guard errors`} />;
        })()}
        <span data-testid="mcp-server-posture" data-allow={summary.allow} data-ask={summary.ask} data-deny={summary.deny} className="" style={{ color: 'var(--ink-muted)' }} title={`what a creator unit gets in ${MODE_LABELS[mode]} mode`}>
          {policies === null ? 'posture unavailable' : summary.text}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <span data-testid={serverApproved ? 'mcp-server-revoke' : needsFirstUse ? 'mcp-server-approve' : undefined} data-disabled={busy}>
            <span data-testid="mcp-server-test"><span data-testid="mcp-server-remove" data-disabled={busy}>
              <OverflowMenu label={`More actions for ${server.name}`} items={[
                ...(needsFirstUse && !serverApproved ? [{id:'approve',label:'Approve first use',disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => onAct(`Approved the first use of ${server.name}`, () => mcpApi.approve(serverSubject(server.name)))}] : []),
                ...(serverApproved ? [{id:'revoke',label:'Revoke server',danger:true,disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => onAct(`Revoked ${server.name}`, () => mcpApi.revoke(serverSubject(server.name)))}] : []),
                {id:'test',label:'Test',disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => onAct(`Tested ${server.name}`, () => mcpApi.test(server.name))},
                {id:'remove',label:'Remove…',danger:true,disabled:busy ? 'Wait for the current change to finish.' : null,onSelect:() => setConfirmRemove(true)},
              ]} />
            </span></span>
          </span>
          {confirmRemove ? (
            <span className="flex items-center gap-1" style={{ color: 'var(--status-fail)' }}>
              <span data-testid="mcp-server-remove-consequence">
                Removes {live.length} tool{live.length === 1 ? '' : 's'} and withdraws their approvals; calls are refused from the next call.
              </span>
              <button type="button" data-testid="mcp-server-remove-confirm" disabled={busy} onClick={() => { setConfirmRemove(false); onAct(`Removed ${server.name}`, () => mcpApi.remove(server.name)); }} className="wk-btn wk-btn--danger" >
                Remove
              </button>
              <button type="button" onClick={() => setConfirmRemove(false)} className="wk-btn wk-btn--secondary" >Keep</button>
            </span>
          ) : null}
        </span>
      </div>
      {open && (
        <div className="flex flex-col pb-1">
          <TechDetails text={`${server.kind === 'mcp-stdio' ? `${server.command ?? ''} ${server.args.join(' ')}` : server.url}${server.auth !== null ? ` · secret ${server.auth.ref}` : ''}${health.lastError !== null ? ` · ${health.lastError}` : ''}`} />
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
      // (review of PR #391, HIGH) The SUCCESS path needs the same guard as the failure path. The
      // secret value is not in `formKey`, so a preview probed with a typo would otherwise be shown
      // — and saved by its `previewHash`, committing that typo — beside a form already showing the
      // correction. `stillMine()` reads the value too.
      if (stillMine()) setHeld({ key: asked, preview: answer });
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

  const input = 'wk-field';
  const pol = preview?.policies ?? null;
  return (
    <section data-testid="mcp-add-panel" className="wk-card wk-pg-mcp-form flex flex-col gap-2" >
      <div className="flex items-center gap-2">
        <SectionTitle>{kind === 'rest' ? 'Wrap a REST API' : 'Add an existing MCP server'}</SectionTitle>
        <button type="button" data-testid="mcp-add-cancel" onClick={onClose} className="wk-btn wk-btn--quiet" >Cancel</button>
      </div>
      <p className="" style={{ color: 'var(--ink-muted)' }}>
        Preview the tools and their access settings, then save to register the server.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          Name
          <input data-testid="mcp-add-name" value={name} onChange={(e) => { setName(e.target.value); setReplaceOk(false); setPreview(null); }} placeholder="jira" spellCheck={false} className={`${input} w-32`}  />
        </label>
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          Kind
          <select data-testid="mcp-add-kind" value={kind} onChange={(e) => { setKind(e.target.value as McpUpstreamKind); setPreview(null); }} className={input} >
            <option value="mcp-stdio">stdio command</option>
            <option value="mcp-http">http URL</option>
            <option value="rest">REST API (OpenAPI)</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          {kind === 'mcp-stdio' ? 'Command (with its arguments)' : kind === 'rest' ? 'Base URL (every call is pinned to it)' : 'URL'}
          <input data-testid="mcp-add-target" value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }} placeholder={kind === 'mcp-stdio' ? 'npx -y @acme/jira-mcp' : kind === 'rest' ? 'https://api.example.com/v1' : 'https://mcp.example.com/mcp'} spellCheck={false} className={input}  />
        </label>
        {kind === 'rest' && (
          <label className="flex min-w-0 flex-1 flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
            OpenAPI document URL
            <input data-testid="mcp-add-openapi-url" value={openapiUrl} onChange={(e) => { setOpenapiUrl(e.target.value); setPreview(null); }} placeholder="https://api.example.com/openapi.json" spellCheck={false} className={input}  />
          </label>
        )}
      </div>
      {kind === 'rest' && (
        <p data-testid="mcp-add-rest-note" className="" style={{ color: 'var(--ink-dim)' }}>
          Each operation becomes a tool: GET reads, POST writes, PUT, PATCH and DELETE are destructive. A call sends only the arguments its operation declares, and only to the base URL; a request or redirect that would leave it is refused and recorded.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          Secret reference (optional)
          <input data-testid="mcp-add-auth-ref" value={authRef} onChange={(e) => { setAuthRef(e.target.value); setPreview(null); }} placeholder="env:JIRA_TOKEN" spellCheck={false} className={`${input} w-48`}  />
        </label>
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
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

          />
        </label>
        <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
          {kind === 'mcp-stdio' ? 'Injected as env var' : 'Injected as header'}
          <input data-testid="mcp-add-auth-into" value={authEnv} onChange={(e) => { setAuthEnv(e.target.value); setPreview(null); }} placeholder={kind === 'mcp-stdio' ? 'JIRA_TOKEN' : 'Authorization'} spellCheck={false} className={`${input} w-40`}  />
        </label>
        {kind !== 'mcp-stdio' && (
          <label className="flex flex-col gap-1" style={{ color: 'var(--ink-muted)' }}>
            Behind scheme
            <input data-testid="mcp-add-auth-prefix" value={authPrefix} onChange={(e) => { setAuthPrefix(e.target.value); setPreview(null); }} placeholder="Bearer" spellCheck={false} className={`${input} w-28`}  />
          </label>
        )}
        {kind !== 'mcp-stdio' && authEnv.trim() !== '' && (
          // The header as it will be sent, spacing included — a trailing space is invisible in
          // the box, and `Bearertoken` 401s exactly like no header at all.
          <p data-testid="mcp-add-auth-shape" className="" style={{ color: 'var(--ink-dim)' }}>
            {authEnv.trim()}: {schemePrefix(authPrefix)}&lt;the secret&gt;
          </p>
        )}
        <p className="max-w-[22rem]" style={{ color: 'var(--ink-dim)' }}>
          A pasted value is probed with, then written to the OS keychain when you SAVE — together with the server, so neither can land without the other. The registry keeps the reference only. The broker resolves it on each call, sends it {kind === 'mcp-stdio' ? 'in that env var' : 'in that header behind that scheme'}, and no worker ever sees the value.
        </p>
        <button type="button" data-testid="mcp-add-preview" disabled={!ready || busy} onClick={() => void doPreview()} className="wk-btn wk-btn--secondary" >
          {busy && preview === null ? 'Probing…' : 'Preview'}
        </button>
      </div>
      {replacesLiveSecret && (
        // The consent line said "Previewing writes this secret over the one X uses now", which was
        // true of the pre-write ordering crew#719 removed. Saving is now the one write, and the
        // effect on a LIVE server is the same either way: its next call uses the new value.
        <div data-testid="mcp-add-replace-secret" className="flex flex-wrap items-start gap-2" style={{ color: 'var(--status-gate)' }}>
          <Switch data-testid="mcp-add-replace-secret-ok" label="Replace the saved secret" checked={replaceOk} onChange={setReplaceOk} />
          <span>
            {name} is already registered. Saving writes this secret over the one {name} uses now — its
            next call, and any run in flight, uses the new value. The old value cannot be recovered.
            Previewing only probes with it; nothing is written until you save.
          </span>
        </div>
      )}
      {error !== null && (
        <StateBanner data-testid="mcp-add-error" kind={readErrorKind(error)} what="the server preview" error={error} onRetry={() => void doPreview()} />
      )}
      {preview !== null && (
        <div data-testid="mcp-add-preview-result" data-preview-hash={preview.previewHash} className="flex flex-col gap-2">
          <p className="" style={{ color: 'var(--ink-muted)' }}>
            {preview.serverInfo !== null ? `${preview.serverInfo.name} ${preview.serverInfo.version} · ` : ''}
            {preview.tools.length} tool{preview.tools.length === 1 ? '' : 's'}
            {preview.diff !== null && ` · replaces the saved ${name}: ${preview.diff.added.length} added, ${preview.diff.changed.length} changed, ${preview.diff.removed.length} removed`}
          </p>
          {preview.skipped !== undefined && preview.skipped.length > 0 && (
            <div data-testid="mcp-add-skipped">
              <p className="wk-field-note">{preview.skipped.length === 1 ? 'One tool' : `${preview.skipped.length} tools`} can’t be managed here and will be left out.</p>
              <TechDetails text={preview.skipped} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" data-testid="mcp-add-save" disabled={busy} onClick={() => void doSave()} className="wk-btn wk-btn--primary" >
              {busy ? 'Saving…' : `Save ${preview.tools.length} tool${preview.tools.length === 1 ? '' : 's'}`}
            </button>
            <span className="" style={{ color: 'var(--ink-dim)' }}>
              Registers exactly this preview (it expires {ageOf(preview.expiresAt) === 'just now' ? 'soon' : `at ${new Date(preview.expiresAt).toLocaleTimeString()}`}). The first use of the server asks until you approve it.
            </span>
          </div>
          {pol === null ? (
            <p data-testid="mcp-add-no-matrix" className="wk-field-note">Policy previews are unavailable. Your access rules still apply after saving.</p>
          ) : (
            <>
              {pol.withdrawOnSave.length > 0 && (
                <p data-testid="mcp-add-withdraw" className="" style={{ color: 'var(--status-warn)' }}>
                  Saving withdraws these approvals, because a tool&rsquo;s schema changed: {pol.withdrawOnSave.join(', ')}. Their next call asks again.
                </p>
              )}
              <ul className="flex flex-col gap-2">
                {pol.tools.map((t) => (
                  <li key={t.subject} data-testid="mcp-add-preview-tool" data-subject={t.subject} data-class={t.class} className="flex flex-col gap-1">
                    <span className="flex items-center gap-2">
                      <span className="" style={{ color: 'var(--ink-high)' }}>{t.tool}</span>
                      <Badge text={t.class} style={{ color: 'var(--status-warn)' }} />
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
  const [usageRefresh, setUsageRefresh] = useState(0);
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
      setState(isMcpUnsupported(e) ? { kind: 'unsupported' } : { kind: 'failed', message: msg(e), errorKind: readErrorKind(e) });
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
    <div className="wk-pg-mcp-scroll">
      <PageFrame data-testid="mcp-tools-page" title="MCP tools" intro="Choose the tools your helpers can use and when they need your approval."
        actions={<>
          <a className="wk-link" href={`${policiesPath()}?mcp=1`} onClick={(e) => { e.preventDefault(); navigate(`${policiesPath()}?mcp=1`); }} data-testid="mcp-steering-link">MCP policies</a>
          {view === 'servers' && loaded !== null && !adding && <button type="button" data-testid="mcp-add-open" onClick={() => setAdding(true)} className="wk-btn wk-btn--primary">Add existing server</button>}
          <button type="button" className="wk-btn wk-btn--secondary" onClick={() => { void load(); setUsageRefresh((n) => n + 1); }}>Refresh</button>
        </>}>
        {view === 'servers' && <div className="wk-pg-mcp-mode">
          <p className="wk-field-label">When helpers use tools</p>
          <div data-testid="mcp-mode-option"><Segmented data-testid="mcp-mode" label="When helpers use tools" value={mode} options={MODES.map(m => ({value:m,label:MODE_LABELS[m]}))} onChange={setMode} /></div>
        </div>}

        <div data-testid="mcp-view-tab"><Tabs data-testid="mcp-view" aria-label="MCP tools view" idBase="mcp-tools" active={view} tabs={[{id:'servers',label:'Servers'},{id:'usage',label:'Usage'}]} onChange={v => navigate(v === 'usage' ? mcpUsagePath() : mcpPath())} /></div>

        {view === 'usage' && <McpUsage navigate={navigate} filter={usageFilter} onFilter={setUsageFilter} refreshKey={usageRefresh} />}

        {view === 'servers' && state.kind === 'loading' && <Skeleton data-testid="mcp-loading" />}
        {view === 'servers' && state.kind === 'unsupported' && (
          <EmptyState data-testid="mcp-unsupported" title="MCP tools are unavailable in this version" body="Update Studio’s service to register servers here." />
        )}
        {view === 'servers' && state.kind === 'failed' && (
          <StateBanner data-testid="mcp-error" kind={state.errorKind} what="MCP tools" error={state.message} onRetry={() => void load()} />
        )}

        {view === 'servers' && note !== null && (note.ok || state.kind !== 'failed') && (
          <div data-testid="mcp-note" data-ok={note.ok}>
            {note.ok ? <p>{note.text}</p> : <StateBanner kind={readErrorKind(note.text)} what="the change" error={note.text} onRetry={() => { setNote(null); void load(); }} />}
          </div>
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
              <p data-testid="mcp-pending" data-first-use={pendingFirst} data-write={pendingWrites} className="rounded px-3 py-2" style={{ color: 'var(--status-gate)' }}>
                {pendingFirst > 0 && `${pendingFirst} server${pendingFirst === 1 ? '' : 's'} not yet approved for first use`}
                {pendingFirst > 0 && pendingWrites > 0 && ' · '}
                {pendingWrites > 0 && `${pendingWrites} write tool${pendingWrites === 1 ? '' : 's'} ask in Gate by risk`}
                . A call that asks does not run until you approve it from that server’s or tool’s More actions menu.
              </p>
            )}
            {loaded.policies === null && loaded.servers.servers.length > 0 && (
              <p data-testid="mcp-no-policies" className="" style={{ color: 'var(--status-warn)' }}>
                Policy previews are unavailable in this version of Studio’s service.
              </p>
            )}
            {loaded.servers.servers.length === 0 ? (
              <EmptyState data-testid="mcp-empty" title="No MCP servers registered" body="Add an existing server so your helpers can use its tools." />
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

            {loaded.servers.discovered.some(d => !/agy|antigravity/i.test(d.cli)) && (
              <section data-testid="mcp-discovered" className="wk-card flex flex-col gap-1">
                <SectionTitle>Discovered tools</SectionTitle>
                <p className="" style={{ color: 'var(--ink-dim)' }}>
                  Your helpers already have these servers configured. To manage their access here, add each one with “Add existing server”.
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {loaded.servers.discovered.filter(d => !/agy|antigravity/i.test(d.cli)).map((d) => (
                    <li key={`${d.cli}-${d.origin}-${d.name}`}>
                      <Badge
                        testid="mcp-discovered-server"
                        text={`${d.name} · ${seatLabel({key:d.cli})}${d.origin === 'worker' ? ' · helper settings' : ''}${d.managed ? ' · managed' : ''}`}
                        style={{ color: 'var(--status-fail)' }}
                        title="Found in helper settings"
                      />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </PageFrame>
    </div>
  );
}
