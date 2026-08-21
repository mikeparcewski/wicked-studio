import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { GovernancePolicy } from '../api/types.js';

const EFFECT_COLOR: Record<string, string> = {
  deny: 'var(--status-fail)',
  allow_with_conditions: 'var(--status-gate)',
  allow: 'var(--status-run)',
};

const SEVERITY_COLOR: Record<string, string> = {
  high: 'var(--status-fail)',
  medium: 'var(--status-gate)',
  low: 'var(--ink-dim)',
};

const POLICY_TEMPLATE: GovernancePolicy = {
  id: '',
  kind: 'output',
  applies_to: [],
  effect: 'deny',
  trigger: { contains: '' },
  obligations: [],
  criteria: '',
  severity: 'high',
  rule: '',
};

function PolicyRow({
  policy,
  onEdit,
  onRetire,
}: {
  policy: GovernancePolicy;
  onEdit: (p: GovernancePolicy) => void;
  onRetire: (id: string) => Promise<void>;
}): React.ReactElement {
  // Retiring is a governance action with a visible blast radius (the policy stops deciding gates),
  // so it takes a second click. Inline rather than window.confirm: a modal dialog blocks the page
  // for anything driving this UI programmatically.
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const retired = policy.retired === true;

  return (
    <tr
      className="text-[11px]"
      style={{
        borderBottom: '1px solid var(--surface-raised)',
        opacity: retired ? 0.45 : 1,
      }}
    >
      <td className="px-3 py-2 font-mono" style={{ color: 'var(--ink-muted)' }}>
        {policy.id}
        {retired && (
          <span
            className="ml-2 inline-flex rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
            style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            retired
          </span>
        )}
      </td>
      <td className="px-3 py-2" style={{ color: 'var(--ink-muted)' }}>{policy.kind}</td>
      <td className="px-3 py-2">
        <span
          className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
          style={{ background: 'var(--surface-raised)', color: EFFECT_COLOR[policy.effect] ?? 'var(--ink-muted)' }}
        >
          {policy.effect}
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] font-semibold" style={{ color: SEVERITY_COLOR[policy.severity] ?? 'var(--ink-muted)' }}>
        {policy.severity}
      </td>
      <td className="px-3 py-2 truncate max-w-xs" style={{ color: 'var(--ink-muted)' }}>{policy.rule}</td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onEdit(policy)}
            className="text-[10px] hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            Edit
          </button>
          {!retired && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (!armed) {
                  setArmed(true);
                  return;
                }
                setBusy(true);
                void onRetire(policy.id).finally(() => {
                  setBusy(false);
                  setArmed(false);
                });
              }}
              className="text-[10px] hover:underline disabled:opacity-50"
              style={{ color: armed ? 'var(--status-fail)' : 'var(--ink-dim)' }}
            >
              {busy ? 'Retiring…' : armed ? 'Confirm retire' : 'Retire'}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

export function PolicyManager(): React.ReactElement {
  const [policies, setPolicies] = useState<GovernancePolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editorJson, setEditorJson] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { policies: ps } = await api.listPolicies();
      setPolicies(ps);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Retire, not delete: the policy stays on the list (past decisions cite it) and stops enforcing.
  const handleRetire = useCallback(async (id: string) => {
    setError(null);
    try {
      await api.retirePolicy(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);

  const openEditor = (policy?: GovernancePolicy) => {
    setEditorJson(JSON.stringify(policy ?? POLICY_TEMPLATE, null, 2));
    setParseError(null);
    setSaveStatus('idle');
    setSaveError(null);
  };

  const handleEditorChange = (v: string) => {
    setEditorJson(v);
    try {
      JSON.parse(v);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    if (parseError) return;
    let policy: GovernancePolicy;
    try {
      policy = JSON.parse(editorJson) as GovernancePolicy;
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await api.upsertPolicy(policy);
      setSaveStatus('ok');
      await load();
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Policies</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => openEditor()}
          className="ml-auto rounded px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          + New policy
        </button>
      </div>

      {error && (
        <p
          className="rounded px-2 py-1 text-xs"
          style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading policies…</p>
      ) : (
        <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--surface-raised)' }}>
          <table className="w-full text-[11px]">
            <thead>
              <tr
                className="text-[10px] uppercase tracking-wider"
                style={{ borderBottom: '1px solid var(--surface-raised)', background: 'var(--surface-rail)', color: 'var(--ink-dim)' }}
              >
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Kind</th>
                <th className="px-3 py-2 text-left">Effect</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Rule</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {policies.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs" style={{ color: 'var(--ink-dim)' }}>
                    No policies registered.
                  </td>
                </tr>
              ) : (
                policies.map((p) => (
                  <PolicyRow key={p.id} policy={p} onEdit={openEditor} onRetire={handleRetire} />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editorJson !== '' && (
        <div
          className="flex flex-col gap-2 rounded p-3"
          style={{ border: '1px solid var(--status-gate-dim)', background: 'var(--surface-rail)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: 'var(--status-gate)' }}>Policy JSON</span>
            <button
              type="button"
              onClick={() => { setEditorJson(''); setSaveStatus('idle'); }}
              className="ml-auto text-[10px] hover:underline"
              style={{ color: 'var(--ink-dim)' }}
            >
              Cancel
            </button>
          </div>
          <textarea
            aria-label="Policy JSON editor"
            value={editorJson}
            onChange={(e) => handleEditorChange(e.target.value)}
            spellCheck={false}
            className="rounded p-2 font-mono text-[10px] focus:outline-none min-h-[200px] resize-y"
            style={{ background: 'var(--surface-base)', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }}
          />
          {parseError && (
            <p className="text-[10px]" style={{ color: 'var(--status-fail)' }}>{parseError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!!parseError || saveStatus === 'saving'}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
              style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save policy'}
            </button>
            {saveStatus === 'ok' && <span className="text-[10px]" style={{ color: 'var(--status-run)' }}>Saved.</span>}
            {saveStatus === 'error' && (
              <span className="text-[10px]" style={{ color: 'var(--status-fail)' }}>{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
