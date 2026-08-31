import { useState } from 'react';
import { api } from '../api/client.js';
import {
  isValidRuleId,
  nextRuleId,
  STEERING_RULE_TEMPLATE,
  STEERING_TYPE_LABELS,
  type SteeringEffect,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';
import { useModalEscape } from './Modal.js';

/**
 * The individual Add/Edit rule form — a MODAL now (opened on demand from the Add menu or the
 * drawer's Edit, never rendered open by default), over the same SHIPPING upsert CRUD
 * (`POST /governance/rules`) as before: statement, severity, rule_type, applies_to/excludes
 * chips, weight, optional effect+trigger. Adding derives a fresh INV-C1 id and stamps
 * provenance source "ui"; editing keeps the id/rule_type fixed and carries provenance through
 * untouched — an edit never rewrites where a rule came from.
 */

/** A chips editor: type, Enter (or comma) adds; each chip removable. */
function ChipsInput({ testid, label, values, onChange, placeholder }: {
  testid: string;
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const commit = (): void => {
    const v = draft.trim().replace(/,+$/, '');
    if (v === '' || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
      {label}
      <span className="flex flex-wrap items-center gap-1 rounded px-2 py-1" style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)' }}>
        {values.map((v) => (
          <span key={v} data-testid={`${testid}-chip`} className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:opacity-70"
              style={{ color: 'var(--ink-dim)' }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          data-testid={testid}
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          }}
          onBlur={commit}
          className="min-w-[8rem] flex-1 bg-transparent text-[11px] focus:outline-none"
          style={{ color: 'var(--ink-high)' }}
        />
      </span>
    </label>
  );
}

interface FormState {
  /** Editing keeps the id/rule_type fixed (INV-C1 binds them); adding derives a fresh id. */
  editing: boolean;
  id: string;
  rule_type: 'pattern' | 'policy';
  statement: string;
  severity: string;
  applies_to: string[];
  excludes: string[];
  weight: string;
  effect: '' | SteeringEffect;
  triggerContains: string;
  /** Carried through an edit untouched — the form does not manage these. */
  base: SteeringRule;
}

function formFromRule(rule: SteeringRule): FormState {
  return {
    editing: true,
    id: rule.id,
    rule_type: rule.rule_type,
    statement: rule.statement,
    severity: rule.severity,
    applies_to: rule.applies_to ?? [],
    excludes: rule.excludes ?? [],
    weight: String(rule.weight ?? 1.0),
    effect: rule.effect ?? '',
    triggerContains: rule.trigger?.contains ?? '',
    base: rule,
  };
}

function freshForm(rules: SteeringRule[], type: SteeringType): FormState {
  const base: SteeringRule = { ...STEERING_RULE_TEMPLATE, steering_type: type };
  return {
    editing: false,
    id: nextRuleId(rules, 'pattern'),
    rule_type: 'pattern',
    statement: '',
    severity: 'warn',
    applies_to: [],
    excludes: [],
    weight: '1.0',
    effect: '',
    triggerContains: '',
    base,
  };
}

/**
 * The modal wrapper + the form. `initial` null = add (fresh INV-C1 id from the loaded corpus);
 * a rule = edit (id fixed, provenance carried through untouched).
 */
export function SteeringRuleFormModal({ type, rules, initial, onClose, onSaved }: {
  type: SteeringType;
  /** The loaded corpus — the fresh-id suggestion derives from it (the store stays authoritative). */
  rules: SteeringRule[];
  initial: SteeringRule | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}): React.ReactElement {
  const [form, setForm] = useState<FormState>(() =>
    initial !== null ? formFromRule(initial) : freshForm(rules, type),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalEscape(onClose);

  const weightNum = Number(form.weight);
  const idOk = isValidRuleId(form.id, form.rule_type);
  const valid =
    idOk && form.statement.trim() !== '' && Number.isFinite(weightNum) && weightNum >= 0;

  const save = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    // Everything the form does not manage (confidence, targets, provenance, compliance,
    // obligations, criteria) rides through from `base` untouched; UI authorship stamps
    // provenance source "ui" on NEW rules only — an edit never rewrites where a rule came from.
    const rule: SteeringRule = {
      ...form.base,
      id: form.id.trim(),
      rule_type: form.rule_type,
      statement: form.statement.trim(),
      severity: form.severity as SteeringRule['severity'],
      steering_type: type,
      applies_to: form.applies_to,
      excludes: form.excludes,
      weight: weightNum,
      ...(form.effect !== '' ? { effect: form.effect } : {}),
      ...(form.effect !== '' && form.triggerContains.trim() !== ''
        ? { trigger: { contains: form.triggerContains.trim() } }
        : {}),
    };
    if (form.effect === '') {
      delete rule.effect;
      delete rule.trigger;
    }
    try {
      await api.upsertConformanceRule(rule);
      onSaved(rule.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const onChange = setForm;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="steering-rule-form"
        role="dialog"
        aria-modal="true"
        aria-label={form.editing ? `Edit ${form.base.id}` : 'Add rule'}
        className="flex max-h-[86vh] w-[34rem] max-w-[92vw] flex-col gap-2 overflow-y-auto rounded-xl p-4 shadow-2xl"
        style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
            {form.editing ? `Edit ${form.base.id}` : 'Add rule'}
          </span>
          <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            type: {STEERING_TYPE_LABELS[type]} (this page)
          </span>
          <button
            data-testid="steering-form-cancel"
            type="button"
            onClick={onClose}
            className="ml-auto text-[10px] hover:underline"
            style={{ color: 'var(--ink-dim)' }}
          >
            Cancel
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Rule type
            <select
              data-testid="steering-form-rule-type"
              aria-label="Rule type"
              value={form.rule_type}
              disabled={form.editing}
              onChange={(e) => {
                const rt = e.target.value as 'pattern' | 'policy';
                // A fresh id follows the prefix (INV-C1 binds PAT⇔pattern, POL⇔policy).
                onChange({ ...form, rule_type: rt, id: nextRuleId(rules, rt) });
              }}
              className="rounded px-1.5 py-1 text-[11px] focus:outline-none disabled:opacity-50"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              <option value="pattern">pattern</option>
              <option value="policy">policy</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Id
            <input
              data-testid="steering-form-id"
              type="text"
              value={form.id}
              readOnly={form.editing}
              spellCheck={false}
              onChange={(e) => onChange({ ...form, id: e.target.value })}
              className="w-28 rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
              style={{
                background: 'var(--surface-base)',
                border: `1px solid ${idOk ? 'var(--surface-raised)' : 'var(--status-fail)'}`,
                color: 'var(--ink-high)',
              }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Severity
            <select
              data-testid="steering-form-severity"
              aria-label="Severity"
              value={form.severity}
              onChange={(e) => onChange({ ...form, severity: e.target.value })}
              className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              {['info', 'warn', 'error', 'critical'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Weight
            <input
              data-testid="steering-form-weight"
              type="number"
              step="0.1"
              min="0"
              aria-label="Weight"
              value={form.weight}
              onChange={(e) => onChange({ ...form, weight: e.target.value })}
              className="w-20 rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Statement
          <textarea
            data-testid="steering-form-statement"
            value={form.statement}
            onChange={(e) => onChange({ ...form, statement: e.target.value })}
            placeholder="The prescriptive sentence this rule enforces"
            className="min-h-[3rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>

        <ChipsInput
          testid="steering-form-applies"
          label="Applies to (phases/tools — inclusion)"
          values={form.applies_to}
          onChange={(v) => onChange({ ...form, applies_to: v })}
          placeholder="add and press Enter"
        />
        <ChipsInput
          testid="steering-form-excludes"
          label="Excludes (phases/tools this rule skips)"
          values={form.excludes}
          onChange={(v) => onChange({ ...form, excludes: v })}
          placeholder="add and press Enter"
        />

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Effect (optional — none = recall-only)
            <select
              data-testid="steering-form-effect"
              aria-label="Effect"
              value={form.effect}
              onChange={(e) => onChange({ ...form, effect: e.target.value as FormState['effect'] })}
              className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            >
              <option value="">none (recall-only)</option>
              <option value="deny">deny</option>
              <option value="allow_with_conditions">allow_with_conditions</option>
              <option value="allow">allow</option>
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Trigger text (optional; needs an effect)
            <input
              data-testid="steering-form-trigger"
              type="text"
              value={form.triggerContains}
              disabled={form.effect === ''}
              spellCheck={false}
              onChange={(e) => onChange({ ...form, triggerContains: e.target.value })}
              placeholder='e.g. "rm -rf" — the effect fires when the evaluated context contains this'
              className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none disabled:opacity-50"
              style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
            />
          </label>
        </div>

        {error !== null && (
          <p data-testid="steering-form-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            data-testid="steering-form-save"
            type="button"
            disabled={!valid || busy}
            onClick={() => void save()}
            className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            {busy ? 'Saving…' : form.editing ? 'Save changes' : 'Add rule'}
          </button>
          {!idOk && (
            <span className="text-[10px]" style={{ color: 'var(--status-fail)' }}>
              id must match {form.rule_type === 'pattern' ? 'PAT' : 'POL'}-&lt;3–6 digits&gt;
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
