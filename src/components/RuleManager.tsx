import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ConformanceRule, RulePreviewQuery } from '../api/types.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: '#f85149',
  error: '#f97316',
  warn: '#ffda19',
  info: 'rgba(230,237,243,0.5)',
};

const RULE_TEMPLATE: ConformanceRule = {
  id: '',
  rule_type: 'pattern',
  statement: '',
  severity: 'warn',
  confidence: 0.9,
  targets: {},
  provenance: { source: 'manual', source_kinds: ['policy'] },
};

function RuleRow({
  rule,
  onEdit,
}: {
  rule: ConformanceRule;
  onEdit: (r: ConformanceRule) => void;
}): React.ReactElement {
  return (
    <tr className="text-[11px]" style={{ borderBottom: '1px solid rgba(230,237,243,0.06)' }}>
      <td className="px-3 py-2 font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>{rule.id}</td>
      <td className="px-3 py-2" style={{ color: 'rgba(230,237,243,0.45)' }}>{rule.rule_type}</td>
      <td className="px-3 py-2">
        <span
          className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
          style={{ background: 'rgba(230,237,243,0.06)', color: SEVERITY_COLOR[rule.severity] ?? 'rgba(230,237,243,0.5)' }}
        >
          {rule.severity}
        </span>
      </td>
      <td className="px-3 py-2 truncate max-w-xs" style={{ color: 'rgba(230,237,243,0.6)' }}>{rule.statement}</td>
      <td className="px-3 py-2 text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>
        {[rule.targets?.language, rule.targets?.layer, rule.targets?.framework]
          .filter(Boolean)
          .join(' / ') || '—'}
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onEdit(rule)}
          className="text-[10px] hover:underline"
          style={{ color: '#79c0ff' }}
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

export function RuleManager(): React.ReactElement {
  const [rules, setRules] = useState<ConformanceRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editorJson, setEditorJson] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [previewQuery, setPreviewQuery] = useState<RulePreviewQuery>({});
  const [previewRules, setPreviewRules] = useState<ConformanceRule[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { rules: rs } = await api.listConformanceRules();
      setRules(rs);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openEditor = (rule?: ConformanceRule) => {
    setEditorJson(JSON.stringify(rule ?? RULE_TEMPLATE, null, 2));
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
    let rule: ConformanceRule;
    try {
      rule = JSON.parse(editorJson) as ConformanceRule;
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await api.upsertConformanceRule(rule);
      setSaveStatus('ok');
      await load();
    } catch (e) {
      setSaveStatus('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const { rules: rs } = await api.recallRulesPreview(previewQuery);
      setPreviewRules(rs);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : String(e));
      setPreviewRules(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const pqField = (key: keyof RulePreviewQuery, placeholder: string) => (
    <input
      type="text"
      aria-label={key}
      placeholder={placeholder}
      value={previewQuery[key] ?? ''}
      onChange={(e) => setPreviewQuery((q) => ({ ...q, [key]: e.target.value || undefined }))}
      className="rounded px-2 py-0.5 text-[10px] focus:outline-none w-24"
      style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.1)', color: '#e6edf3' }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Conformance rules</h2>
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] hover:underline"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          Refresh
        </button>
        <button
          type="button"
          onClick={() => openEditor()}
          className="ml-auto rounded px-2 py-1 text-[11px] font-semibold"
          style={{ background: '#ffda19', color: '#0d1117' }}
        >
          + New rule
        </button>
      </div>

      {error && (
        <p className="rounded px-2 py-1 text-xs" style={{ background: 'rgba(248,81,73,0.08)', color: '#f85149' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs" style={{ color: 'rgba(230,237,243,0.4)' }}>Loading rules…</p>
      ) : (
        <div className="overflow-x-auto rounded" style={{ border: '1px solid rgba(230,237,243,0.08)' }}>
          <table className="w-full text-[11px]">
            <thead>
              <tr
                className="text-[10px] uppercase tracking-wider"
                style={{ borderBottom: '1px solid rgba(230,237,243,0.08)', background: '#0f1419', color: 'rgba(230,237,243,0.4)' }}
              >
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Severity</th>
                <th className="px-3 py-2 text-left">Statement</th>
                <th className="px-3 py-2 text-left">Targets</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-xs" style={{ color: 'rgba(230,237,243,0.35)' }}>
                    No conformance rules registered.
                  </td>
                </tr>
              ) : (
                rules.map((r) => (
                  <RuleRow key={r.id} rule={r} onEdit={openEditor} />
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {editorJson !== '' && (
        <div
          className="flex flex-col gap-2 rounded p-3"
          style={{ border: '1px solid rgba(255,218,25,0.25)', background: 'rgba(255,218,25,0.04)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: '#ffda19' }}>Rule JSON</span>
            <button
              type="button"
              onClick={() => { setEditorJson(''); setSaveStatus('idle'); }}
              className="ml-auto text-[10px] hover:underline"
              style={{ color: 'rgba(230,237,243,0.4)' }}
            >
              Cancel
            </button>
          </div>
          <textarea
            aria-label="Conformance rule JSON editor"
            value={editorJson}
            onChange={(e) => handleEditorChange(e.target.value)}
            spellCheck={false}
            className="rounded p-2 font-mono text-[10px] focus:outline-none min-h-[200px] resize-y"
            style={{ background: '#0d1117', color: '#e6edf3', border: '1px solid rgba(230,237,243,0.1)' }}
          />
          {parseError && <p className="text-[10px]" style={{ color: '#f85149' }}>{parseError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!!parseError || saveStatus === 'saving'}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-50"
              style={{ background: '#3fb950', color: '#0d1117' }}
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save rule'}
            </button>
            {saveStatus === 'ok' && <span className="text-[10px]" style={{ color: '#3fb950' }}>Saved.</span>}
            {saveStatus === 'error' && (
              <span className="text-[10px]" style={{ color: '#f85149' }}>{saveError}</span>
            )}
          </div>
        </div>
      )}

      {/* Preview panel */}
      <div
        className="flex flex-col gap-2 rounded p-3"
        style={{ border: '1px solid rgba(230,237,243,0.08)', background: '#0f1419' }}
      >
        <p className="text-[11px] font-semibold" style={{ color: 'rgba(230,237,243,0.7)' }}>Preview — which rules apply?</p>
        <div className="flex flex-wrap gap-2 items-center">
          {pqField('language', 'language')}
          {pqField('layer', 'layer')}
          {pqField('framework', 'framework')}
          {pqField('severity', 'severity')}
          {pqField('rule_type', 'type')}
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={previewLoading}
            className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
            style={{ background: '#1b222e', color: '#e6edf3', border: '1px solid rgba(230,237,243,0.1)' }}
          >
            {previewLoading ? 'Loading…' : 'Preview'}
          </button>
        </div>
        {previewError && <p className="text-[10px]" style={{ color: '#f85149' }}>{previewError}</p>}
        {previewRules !== null && (
          previewRules.length === 0 ? (
            <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.4)' }}>No rules match this query.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {previewRules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[10px]">
                  <span
                    className="inline-flex rounded px-1 text-[9px] font-semibold font-mono"
                    style={{ background: 'rgba(230,237,243,0.06)', color: SEVERITY_COLOR[r.severity] ?? 'rgba(230,237,243,0.5)' }}
                  >
                    {r.severity}
                  </span>
                  <span className="font-mono" style={{ color: 'rgba(230,237,243,0.6)' }}>{r.id}</span>
                  <span className="truncate" style={{ color: 'rgba(230,237,243,0.45)' }}>{r.statement}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
