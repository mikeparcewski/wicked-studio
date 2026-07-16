import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { GovernancePolicy } from '../api/types.js';

const EFFECT_STYLES: Record<string, string> = {
  deny: 'bg-red-100 text-red-800',
  allow_with_conditions: 'bg-yellow-100 text-yellow-800',
  allow: 'bg-green-100 text-green-800',
};

const SEVERITY_STYLES: Record<string, string> = {
  high: 'text-red-600 font-semibold',
  medium: 'text-yellow-600 font-semibold',
  low: 'text-gray-500',
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
}: {
  policy: GovernancePolicy;
  onEdit: (p: GovernancePolicy) => void;
}): React.ReactElement {
  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50 text-[11px]">
      <td className="px-3 py-2 font-mono text-gray-700">{policy.id}</td>
      <td className="px-3 py-2 text-gray-500">{policy.kind}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${EFFECT_STYLES[policy.effect] ?? 'bg-gray-100'}`}>
          {policy.effect}
        </span>
      </td>
      <td className={`px-3 py-2 ${SEVERITY_STYLES[policy.severity] ?? ''}`}>{policy.severity}</td>
      <td className="px-3 py-2 text-gray-500 truncate max-w-xs">{policy.rule}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onEdit(policy)}
          className="text-[10px] text-blue-500 hover:underline"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

/**
 * FR: Policy management panel (crew#42). Lists registered governance policies and
 * provides a JSON editor to create or update them via POST /governance/policies.
 */
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
        <h2 className="text-sm font-semibold text-gray-800">Policies</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => openEditor()}
          className="ml-auto rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-700"
        >
          + New policy
        </button>
      </div>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      {loading ? (
        <p className="text-xs text-gray-400">Loading policies…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
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
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">
                    No policies registered.
                  </td>
                </tr>
              ) : (
                policies.map((p) => (
                  <PolicyRow key={p.id} policy={p} onEdit={openEditor} />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editorJson !== '' && (
        <div className="flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-blue-800">Policy JSON</span>
            <button
              type="button"
              onClick={() => { setEditorJson(''); setSaveStatus('idle'); }}
              className="ml-auto text-[10px] text-gray-400 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <textarea
            aria-label="Policy JSON editor"
            value={editorJson}
            onChange={(e) => handleEditorChange(e.target.value)}
            spellCheck={false}
            className="rounded border border-blue-200 bg-white p-2 font-mono text-[10px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[200px] resize-y"
          />
          {parseError && (
            <p className="text-[10px] text-red-600">{parseError}</p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!!parseError || saveStatus === 'saving'}
              className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save policy'}
            </button>
            {saveStatus === 'ok' && <span className="text-[10px] text-green-600">Saved.</span>}
            {saveStatus === 'error' && (
              <span className="text-[10px] text-red-600">{saveError}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
