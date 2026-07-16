import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { ConformanceRule, RulePreviewQuery } from '../api/types.js';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  error: 'bg-orange-100 text-orange-800',
  warn: 'bg-yellow-100 text-yellow-800',
  info: 'bg-gray-100 text-gray-600',
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
    <tr className="border-b border-gray-100 hover:bg-gray-50 text-[11px]">
      <td className="px-3 py-2 font-mono text-gray-700">{rule.id}</td>
      <td className="px-3 py-2 text-gray-500">{rule.rule_type}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[rule.severity] ?? 'bg-gray-100'}`}>
          {rule.severity}
        </span>
      </td>
      <td className="px-3 py-2 text-gray-600 truncate max-w-xs">{rule.statement}</td>
      <td className="px-3 py-2 text-gray-400 text-[10px]">
        {[rule.targets?.language, rule.targets?.layer, rule.targets?.framework]
          .filter(Boolean)
          .join(' / ') || '—'}
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={() => onEdit(rule)}
          className="text-[10px] text-blue-500 hover:underline"
        >
          Edit
        </button>
      </td>
    </tr>
  );
}

/**
 * FR: Conformance-rule management panel (crew#42). Lists rules, provides a JSON
 * editor to create/update via POST /governance/rules, and a facet-query preview
 * via GET /governance/rules/preview.
 */
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
      className="rounded border border-gray-200 px-2 py-0.5 text-[10px] w-24 focus:outline-none focus:ring-1 focus:ring-blue-300"
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800">Conformance rules</h2>
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
          + New rule
        </button>
      </div>

      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      {loading ? (
        <p className="text-xs text-gray-400">Loading rules…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-gray-500 text-[10px] uppercase tracking-wider">
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
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-400 text-xs">
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
        <div className="flex flex-col gap-2 rounded border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-blue-800">Rule JSON</span>
            <button
              type="button"
              onClick={() => { setEditorJson(''); setSaveStatus('idle'); }}
              className="ml-auto text-[10px] text-gray-400 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
          <textarea
            aria-label="Conformance rule JSON editor"
            value={editorJson}
            onChange={(e) => handleEditorChange(e.target.value)}
            spellCheck={false}
            className="rounded border border-blue-200 bg-white p-2 font-mono text-[10px] text-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 min-h-[200px] resize-y"
          />
          {parseError && <p className="text-[10px] text-red-600">{parseError}</p>}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!!parseError || saveStatus === 'saving'}
              className="rounded bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveStatus === 'saving' ? 'Saving…' : 'Save rule'}
            </button>
            {saveStatus === 'ok' && <span className="text-[10px] text-green-600">Saved.</span>}
            {saveStatus === 'error' && (
              <span className="text-[10px] text-red-600">{saveError}</span>
            )}
          </div>
        </div>
      )}

      {/* Preview panel */}
      <div className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-3">
        <p className="text-[11px] font-semibold text-gray-700">Preview — which rules apply?</p>
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
            className="rounded bg-gray-700 px-2 py-0.5 text-[10px] text-white hover:bg-gray-900 disabled:opacity-50"
          >
            {previewLoading ? 'Loading…' : 'Preview'}
          </button>
        </div>
        {previewError && <p className="text-[10px] text-red-600">{previewError}</p>}
        {previewRules !== null && (
          previewRules.length === 0 ? (
            <p className="text-[10px] text-gray-400">No rules match this query.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {previewRules.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-[10px]">
                  <span className={`inline-flex rounded px-1 text-[9px] font-semibold ${SEVERITY_STYLES[r.severity] ?? ''}`}>
                    {r.severity}
                  </span>
                  <span className="font-mono text-gray-600">{r.id}</span>
                  <span className="text-gray-500 truncate">{r.statement}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </div>
  );
}
