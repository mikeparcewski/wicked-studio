import { useEffect, useMemo, useRef, useState } from 'react';
import {
  nextRuleId,
  ruleIdIssue,
  ruleTypeOfId,
  STEERING_TYPES,
  STEERING_TYPE_LABELS,
  steeringTypeOf,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';
import { FilterStrip } from './dashboardKit.js';
import { SteeringRetireModal } from './SteeringRetireModal.js';

/**
 * The type page's rule GRID — the list became a SPREADSHEET (round-3 operator steer: "steering
 * should be treated like a spreadsheet (adding/removing editing rows)"). One row per rule, the
 * COMMON columns editable inline: id (opens the drawer — the advanced fields stay THERE) ·
 * type · severity · statement · weight · applies_to · excludes · status.
 *
 * Editing contract (keyboard-first):
 *  - Tab walks the cells (every display cell is a real focusable control);
 *  - click or Enter opens a cell's editor; Esc REVERTS and closes; Enter/blur COMMITS;
 *  - severity/type are always-live selects (a select is its own editor — change commits);
 *  - applies_to/excludes are chip cells (type + Enter adds, × removes; Esc reverts the set);
 *  - a commit is a PER-ROW save over the one shipping upsert wire — the shell applies it
 *    optimistically, reverts on error, and reloads for the server's answer (the "where the
 *    server filed it" honesty note lives there).
 *
 * Rows/removal:
 *  - ADD ROW appends one editable draft row — MANUAL id with live validation (the engine's
 *    steering-scoped INV-C1: PAT-/POL- is the reserved doc-ingest namespace, surfaced verbatim);
 *  - REMOVE = retire, never delete (the shared typed-confirmation + reason modal); retired rows
 *    render struck/dimmed and read-only, toggled by the include_retired facet. Un-retire is
 *    deliberately absent — no wire supports it (see SteeringRetireModal).
 *
 * Facets stay client-side over the one rules fetch (FilterStrip: search · severity · retired),
 * page-local, reset by the shell's per-type remount. NOT virtualized on purpose: rule corpora
 * are tens-to-hundreds of rows; virtualize only if row count ever demands it.
 */

export interface GridFacets {
  query: string;
  severity: string;
  /** The include_retired facet — retired rows stay visible (struck/dimmed) while true. */
  includeRetired: boolean;
}

export const GRID_FACETS_DEFAULT: GridFacets = { query: '', severity: 'all', includeRetired: true };

/** The page-scope + facet predicate over the shipping rules wire — pinned by unit test.
 *  A rule belongs to exactly ONE page: `steeringTypeOf` (absent = architecture). */
export function filterSteeringRules(rules: SteeringRule[], type: SteeringType, f: GridFacets): SteeringRule[] {
  const q = f.query.trim().toLowerCase();
  return rules.filter((r) => {
    if (steeringTypeOf(r) !== type) return false;
    if (f.severity !== 'all' && r.severity !== f.severity) return false;
    if (!f.includeRetired && r.retired === true) return false;
    if (q !== '' && !r.id.toLowerCase().includes(q) && !r.statement.toLowerCase().includes(q)) return false;
    return true;
  });
}

const SEVERITIES = ['info', 'warn', 'error', 'critical'] as const;

/** The engine stores weight as an f32 — 1.2 comes back 1.2000000476837158. Display (and
 *  re-edit) the honest 6-significant-digit value, never the float noise. */
export function fmtWeight(w: number): string {
  return String(Number(w.toPrecision(6)));
}

const CELL_TEXT: React.CSSProperties = { color: 'var(--ink-muted)', fontSize: '11px' };
const CELL_INPUT: React.CSSProperties = {
  background: 'var(--surface-base)',
  border: '1px solid var(--accent)',
  color: 'var(--ink-high)',
  fontSize: '11px',
};
const SELECT_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--ink-muted)',
  fontSize: '11px',
};

/** Display-mode cell: a real focusable control so Tab walks the sheet; Enter/click edits. */
function DisplayCell({ testid, label, onEdit, disabled, children, title }: {
  testid: string;
  label: string;
  onEdit: () => void;
  disabled: boolean;
  children: React.ReactNode;
  title?: string | undefined;
}): React.ReactElement {
  return (
    <button
      type="button"
      data-testid={testid}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onEdit}
      className="block w-full truncate rounded px-1.5 py-1 text-left focus:outline-none focus-visible:ring-1"
      style={{ ...CELL_TEXT, background: 'transparent' }}
    >
      {children}
    </button>
  );
}

/** Inline text/number editor: Esc reverts, Enter/blur commits (only when changed). */
function TextCell({ testid, label, value, display, mono, number, disabled, onCommit }: {
  testid: string;
  label: string;
  value: string;
  /** What the display cell shows (defaults to `value`, '—' when empty). */
  display?: React.ReactNode;
  mono?: boolean;
  number?: boolean;
  disabled: boolean;
  onCommit: (next: string) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const displayRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      displayRef.current?.focus();
    }
  }, [editing]);

  const close = (): void => {
    setEditing(false);
    refocus.current = true;
  };
  const commit = (): void => {
    close();
    if (draft !== value) onCommit(draft);
  };

  if (!editing) {
    return (
      <button
        ref={displayRef}
        type="button"
        data-testid={testid}
        aria-label={label}
        title={typeof display === 'string' ? display : value}
        disabled={disabled}
        onClick={() => { setDraft(value); setEditing(true); }}
        className={`block w-full truncate rounded px-1.5 py-1 text-left focus:outline-none focus-visible:ring-1 ${mono === true ? 'font-mono' : ''}`}
        style={{ ...CELL_TEXT, background: 'transparent' }}
      >
        {display ?? (value === '' ? '—' : value)}
      </button>
    );
  }
  return (
    <input
      data-testid={`${testid}-input`}
      aria-label={`${label} (editing)`}
      type={number === true ? 'number' : 'text'}
      step={number === true ? '0.1' : undefined}
      autoFocus
      value={draft}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); setDraft(value); close(); }
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
      }}
      onBlur={commit}
      className={`w-full rounded px-1.5 py-1 focus:outline-none ${mono === true ? 'font-mono' : ''}`}
      style={CELL_INPUT}
    />
  );
}

/** Always-live select cell (a select is its own editor): change commits. */
function SelectCell({ testid, label, value, options, disabled, onCommit }: {
  testid: string;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  disabled: boolean;
  onCommit: (next: string) => void;
}): React.ReactElement {
  return (
    <select
      data-testid={testid}
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
      className="w-full rounded px-1 py-0.5 focus:outline-none focus-visible:ring-1 disabled:opacity-60"
      style={SELECT_STYLE}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function Chips({ values }: { values: string[] }): React.ReactElement {
  if (values.length === 0) return <span style={{ color: 'var(--ink-dim)' }}>—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className="rounded px-1 font-mono text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {v}
        </span>
      ))}
    </span>
  );
}

/** Chip cell editor: Enter/comma adds, × removes, Backspace on empty pops; Esc reverts the SET. */
export function ChipsCell({ testid, label, values, disabled, onCommit }: {
  testid: string;
  label: string;
  values: string[];
  disabled: boolean;
  onCommit: (next: string[]) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draftValues, setDraftValues] = useState<string[]>(values);
  const [draft, setDraft] = useState('');
  const boxRef = useRef<HTMLSpanElement>(null);

  const close = (commit: boolean): void => {
    setEditing(false);
    setDraft('');
    if (commit && draftValues.join('\u0000') !== values.join('\u0000')) onCommit(draftValues);
  };

  const add = (): string[] => {
    const v = draft.trim().replace(/,+$/, '');
    if (v === '' || draftValues.includes(v)) { setDraft(''); return draftValues; }
    const next = [...draftValues, v];
    setDraftValues(next);
    setDraft('');
    return next;
  };

  if (!editing) {
    return (
      <DisplayCell
        testid={testid}
        label={label}
        disabled={disabled}
        onEdit={() => { setDraftValues(values); setEditing(true); }}
        title={values.join(', ')}
      >
        <Chips values={values} />
      </DisplayCell>
    );
  }
  return (
    <span
      ref={boxRef}
      data-testid={`${testid}-editor`}
      className="flex flex-wrap items-center gap-1 rounded px-1.5 py-1"
      style={{ background: 'var(--surface-base)', border: '1px solid var(--accent)' }}
      // Commit when focus leaves the WHOLE editor (chip × buttons included), not per keystroke.
      onBlur={(e) => {
        if (boxRef.current !== null && !boxRef.current.contains(e.relatedTarget as Node)) {
          // The half-typed token counts — an operator who types a value and clicks away meant it.
          const withDraft = draft.trim() !== '' ? [...draftValues, draft.trim()].filter((v, i, a) => a.indexOf(v) === i) : draftValues;
          setEditing(false);
          setDraft('');
          if (withDraft.join('\u0000') !== values.join('\u0000')) onCommit(withDraft);
        }
      }}
    >
      {draftValues.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded px-1 font-mono text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {v}
          <button
            type="button"
            aria-label={`Remove ${v}`}
            onClick={() => setDraftValues((cur) => cur.filter((x) => x !== v))}
            style={{ color: 'var(--ink-dim)' }}
          >
            ×
          </button>
        </span>
      ))}
      <input
        data-testid={`${testid}-input`}
        aria-label={`${label} (editing)`}
        type="text"
        autoFocus
        value={draft}
        spellCheck={false}
        placeholder="add + Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); setDraftValues(values); close(false); }
          else if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (draft.trim() === '') close(true); // Enter on an empty input = done editing
            else add();
          } else if (e.key === 'Backspace' && draft === '') {
            setDraftValues((cur) => cur.slice(0, -1));
          }
        }}
        className="min-w-[4rem] flex-1 bg-transparent text-[11px] focus:outline-none"
        style={{ color: 'var(--ink-high)' }}
      />
    </span>
  );
}

// ── The draft (add) row ───────────────────────────────────────────────────────────────────────

interface DraftState {
  id: string;
  steering_type: SteeringType;
  severity: string;
  statement: string;
  weight: string;
  applies_to: string[];
  excludes: string[];
  saving: boolean;
  error: string | null;
}

function freshDraft(rules: SteeringRule[], type: SteeringType): DraftState {
  return {
    // A SUGGESTION prefill (max PAT ordinal + 1) — the id stays fully manual, per the
    // spreadsheet contract; validation below is the engine's steering-scoped INV-C1.
    id: nextRuleId(rules, 'pattern'),
    steering_type: type,
    severity: 'warn',
    statement: '',
    weight: '1.0',
    applies_to: [],
    excludes: [],
    saving: false,
    error: null,
  };
}

/** Build the exact upsert body a saved draft sends — exported so the test pins it. */
export function draftRule(d: Pick<DraftState, 'id' | 'steering_type' | 'severity' | 'statement' | 'weight' | 'applies_to' | 'excludes'>): SteeringRule {
  return {
    id: d.id.trim(),
    rule_type: ruleTypeOfId(d.id),
    statement: d.statement.trim(),
    severity: d.severity as SteeringRule['severity'],
    confidence: 0.9,
    targets: {},
    // UI authorship is FIRST-CLASS provenance (never a fake doc ref).
    provenance: { source: 'ui', source_kinds: ['doc'] },
    steering_type: d.steering_type,
    applies_to: d.applies_to,
    excludes: d.excludes,
    weight: Number(d.weight),
  };
}

// ── The grid ──────────────────────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = STEERING_TYPES.map((t) => ({ value: t, label: STEERING_TYPE_LABELS[t] }));
const SEVERITY_OPTIONS = SEVERITIES.map((s) => ({ value: s, label: s }));

export function SteeringGrid({ rules, type, loading, error, selectedId, onSelect, onCommit, onCreate, onRetired, addRequestTick = 0 }: {
  /** The FULL store — this grid applies the page scope itself, one predicate everywhere. */
  rules: SteeringRule[];
  type: SteeringType;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  /** The id cell → the rule's DRAWER (advanced fields live there). */
  onSelect: (id: string) => void;
  /** A cell commit: the full next rule (one field changed). The shell owns optimistic
   *  apply / revert-on-error / the server-answer reload + honesty note. */
  onCommit: (next: SteeringRule, prev: SteeringRule) => void;
  /** The draft row's save — resolves when the server accepted (the grid then clears the draft). */
  onCreate: (rule: SteeringRule) => Promise<void>;
  /** After the retire wire succeeded (the shared modal fired it). */
  onRetired: (rule: SteeringRule, reason: string) => void;
  /** Increment to open a draft row from outside (the Add ▾ menu's "Add row"). */
  addRequestTick?: number;
}): React.ReactElement {
  const [facets, setFacets] = useState<GridFacets>(GRID_FACETS_DEFAULT);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [retiring, setRetiring] = useState<SteeringRule | null>(null);

  const visible = useMemo(() => filterSteeringRules(rules, type, facets), [rules, type, facets]);
  const typeRules = useMemo(() => rules.filter((r) => steeringTypeOf(r) === type), [rules, type]);
  const severityCounts = useMemo(() => {
    const counts: Record<string, number> = { all: typeRules.length };
    for (const s of SEVERITIES) counts[s] = typeRules.filter((r) => r.severity === s).length;
    return counts;
  }, [typeRules]);

  // The Add ▾ menu's "Add row" — an external open-draft request.
  const lastTick = useRef(addRequestTick);
  useEffect(() => {
    if (addRequestTick !== lastTick.current) {
      lastTick.current = addRequestTick;
      setDraft((cur) => cur ?? freshDraft(rules, type));
    }
  }, [addRequestTick, rules, type]);

  const commitField = (rule: SteeringRule, patch: Partial<SteeringRule>): void => {
    onCommit({ ...rule, ...patch }, rule);
  };

  const draftIssue = draft === null
    ? null
    : ruleIdIssue(draft.id, ruleTypeOfId(draft.id))
      ?? (!Number.isFinite(Number(draft.weight)) || Number(draft.weight) < 0 ? 'weight must be a number ≥ 0' : null);
  const draftCollision = draft !== null && rules.some((r) => r.id === draft.id.trim());
  const draftReady = draft !== null && draftIssue === null && draft.statement.trim() !== '' && !draft.saving;

  const saveDraft = async (): Promise<void> => {
    if (draft === null || !draftReady) return;
    setDraft({ ...draft, saving: true, error: null });
    try {
      await onCreate(draftRule(draft));
      setDraft(null);
    } catch (e) {
      setDraft((cur) => (cur === null ? null : { ...cur, saving: false, error: e instanceof Error ? e.message : String(e) }));
    }
  };

  const body = (): React.ReactElement => {
    if (loading) {
      return <p data-testid="steering-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>;
    }
    if (error !== null) {
      return (
        <p data-testid="steering-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {error}
        </p>
      );
    }
    if (visible.length === 0 && draft === null) {
      // Three DIFFERENT kinds of empty, each named: facets hid rows that exist; this TYPE has
      // none (the store does — add a row or hand the assistant a doc); the store is empty.
      return (
        <p data-testid="steering-rules-empty" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          {typeRules.length > 0
            ? 'No rules match these filters.'
            : rules.length > 0
              ? `No ${STEERING_TYPE_LABELS[type]} steering rules yet — add a row, or open the assistant to import a doc or author with chat.`
              : 'No steering rules in the store.'}
        </p>
      );
    }
    return (
      <div className="overflow-x-auto rounded" style={{ border: '1px solid var(--surface-raised)' }}>
        {/* table-fixed + explicit column widths: auto layout would hand a LONG statement the
            whole table and squeeze every select to min-content (measured live). The statement
            column takes the slack and truncates; minWidth keeps every column legible — the
            wrapping container scrolls horizontally instead (the page never does). */}
        <table data-testid="steering-grid" className="w-full table-fixed border-collapse" style={{ minWidth: '64rem' }}>
          <colgroup>
            <col style={{ width: '6.5rem' }} />
            <col style={{ width: '8rem' }} />
            <col style={{ width: '6rem' }} />
            <col />
            <col style={{ width: '4rem' }} />
            <col style={{ width: '10rem' }} />
            <col style={{ width: '10rem' }} />
            <col style={{ width: '7.5rem' }} />
          </colgroup>
          <thead>
            <tr style={{ background: 'var(--surface-rail)' }}>
              {['id', 'type', 'severity', 'statement', 'weight', 'applies to', 'excludes', 'status'].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-1.5 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--ink-dim)', borderBottom: '1px solid var(--surface-raised)' }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const retired = r.retired === true;
              return (
                <tr
                  key={r.id}
                  data-testid="steering-grid-row"
                  data-rule-id={r.id}
                  data-retired={retired ? 'true' : 'false'}
                  className="align-top"
                  style={{
                    borderBottom: '1px solid var(--surface-raised)',
                    opacity: retired ? 0.55 : 1,
                    outline: selectedId === r.id ? '1px solid var(--accent)' : 'none',
                    outlineOffset: '-1px',
                  }}
                >
                  <td className="px-0.5 py-0.5">
                    {/* The id cell OPENS THE DRAWER — advanced fields (effect/trigger/obligations/
                        criteria/provenance/evidence) stay there; the grid carries the common columns. */}
                    <button
                      type="button"
                      data-testid="steering-grid-id"
                      aria-expanded={selectedId === r.id}
                      title={`Open ${r.id} — full detail, advanced fields, edit/retire`}
                      onClick={() => onSelect(r.id)}
                      className="block w-full rounded px-1.5 py-1 text-left font-mono text-[11px] hover:underline focus:outline-none focus-visible:ring-1"
                      style={{ color: 'var(--accent)', textDecoration: retired ? 'line-through' : undefined }}
                    >
                      {r.id}
                    </button>
                  </td>
                  <td className="px-0.5 py-0.5">
                    <SelectCell
                      testid="steering-cell-type"
                      label={`${r.id} steering type`}
                      value={steeringTypeOf(r)}
                      options={TYPE_OPTIONS}
                      disabled={retired}
                      onCommit={(v) => commitField(r, { steering_type: v })}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <SelectCell
                      testid="steering-cell-severity"
                      label={`${r.id} severity`}
                      value={r.severity}
                      options={SEVERITY_OPTIONS}
                      disabled={retired}
                      onCommit={(v) => commitField(r, { severity: v as SteeringRule['severity'] })}
                    />
                  </td>
                  <td className="px-0.5 py-0.5" style={{ textDecoration: retired ? 'line-through' : undefined }}>
                    <TextCell
                      testid="steering-cell-statement"
                      label={`${r.id} statement`}
                      value={r.statement}
                      disabled={retired}
                      onCommit={(v) => { if (v.trim() !== '') commitField(r, { statement: v.trim() }); }}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <TextCell
                      testid="steering-cell-weight"
                      label={`${r.id} weight`}
                      value={fmtWeight(r.weight ?? 1)}
                      display={r.weight === undefined ? <span title="this wire predates weights — the engine defaults to 1.0">1</span> : fmtWeight(r.weight)}
                      number
                      mono
                      disabled={retired}
                      onCommit={(v) => {
                        const n = Number(v);
                        if (Number.isFinite(n) && n >= 0) commitField(r, { weight: n });
                      }}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <ChipsCell
                      testid="steering-cell-applies"
                      label={`${r.id} applies to`}
                      values={r.applies_to ?? []}
                      disabled={retired}
                      onCommit={(v) => commitField(r, { applies_to: v })}
                    />
                  </td>
                  <td className="px-0.5 py-0.5">
                    <ChipsCell
                      testid="steering-cell-excludes"
                      label={`${r.id} excludes`}
                      values={r.excludes ?? []}
                      disabled={retired}
                      onCommit={(v) => commitField(r, { excludes: v })}
                    />
                  </td>
                  <td className="px-1.5 py-1.5">
                    {retired ? (
                      <span
                        data-testid="steering-rule-retired-chip"
                        title="withdrawn from recall and enforcement; kept listed because past decisions cite it — no un-retire wire exists"
                        className="rounded px-1.5 text-[9px] font-semibold uppercase"
                        style={{ background: 'var(--surface-raised)', color: 'var(--ink-dim)' }}
                      >
                        retired
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-[10px]" style={{ color: 'var(--status-done)' }}>active</span>
                        <button
                          type="button"
                          data-testid="steering-grid-retire"
                          title={`Retire ${r.id} — withdraw from recall (typed confirmation + reason)`}
                          aria-label={`Retire ${r.id}`}
                          onClick={() => setRetiring(r)}
                          className="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus-visible:ring-1"
                          style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
                        >
                          Retire…
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {draft !== null && (
              <tr data-testid="steering-grid-draft" className="align-top" style={{ background: 'var(--surface-rail)' }}>
                <td className="px-0.5 py-0.5">
                  <input
                    data-testid="steering-draft-id"
                    aria-label="New rule id"
                    aria-invalid={draftIssue !== null}
                    type="text"
                    autoFocus
                    value={draft.id}
                    spellCheck={false}
                    onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }}
                    className="w-full rounded px-1.5 py-1 font-mono text-[11px] focus:outline-none"
                    style={{
                      background: 'var(--surface-base)',
                      border: `1px solid ${draftIssue === null ? 'var(--surface-raised)' : 'var(--status-fail)'}`,
                      color: 'var(--ink-high)',
                    }}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <SelectCell
                    testid="steering-draft-type"
                    label="New rule steering type"
                    value={draft.steering_type}
                    options={TYPE_OPTIONS}
                    disabled={false}
                    onCommit={(v) => setDraft({ ...draft, steering_type: v as SteeringType })}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <SelectCell
                    testid="steering-draft-severity"
                    label="New rule severity"
                    value={draft.severity}
                    options={SEVERITY_OPTIONS}
                    disabled={false}
                    onCommit={(v) => setDraft({ ...draft, severity: v })}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <input
                    data-testid="steering-draft-statement"
                    aria-label="New rule statement"
                    type="text"
                    value={draft.statement}
                    placeholder="The prescriptive sentence this rule enforces"
                    onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setDraft(null);
                      if (e.key === 'Enter') { e.preventDefault(); void saveDraft(); }
                    }}
                    className="w-full rounded px-1.5 py-1 text-[11px] focus:outline-none"
                    style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <input
                    data-testid="steering-draft-weight"
                    aria-label="New rule weight"
                    type="number"
                    step="0.1"
                    min="0"
                    value={draft.weight}
                    onChange={(e) => setDraft({ ...draft, weight: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }}
                    className="w-full rounded px-1.5 py-1 font-mono text-[11px] focus:outline-none"
                    style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <ChipsCell
                    testid="steering-draft-applies"
                    label="New rule applies to"
                    values={draft.applies_to}
                    disabled={false}
                    onCommit={(v) => setDraft((cur) => (cur === null ? null : { ...cur, applies_to: v }))}
                  />
                </td>
                <td className="px-0.5 py-0.5">
                  <ChipsCell
                    testid="steering-draft-excludes"
                    label="New rule excludes"
                    values={draft.excludes}
                    disabled={false}
                    onCommit={(v) => setDraft((cur) => (cur === null ? null : { ...cur, excludes: v }))}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      data-testid="steering-draft-save"
                      disabled={!draftReady}
                      onClick={() => void saveDraft()}
                      className="rounded px-2 py-0.5 text-[10px] font-semibold disabled:opacity-40 focus:outline-none focus-visible:ring-1"
                      style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
                    >
                      {draft.saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      data-testid="steering-draft-discard"
                      onClick={() => setDraft(null)}
                      className="rounded px-1.5 py-0.5 text-[10px] focus:outline-none focus-visible:ring-1"
                      style={{ color: 'var(--ink-dim)', border: '1px solid var(--surface-raised)' }}
                    >
                      Discard
                    </button>
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div data-testid="steering-rule-grid" className="flex min-w-0 flex-col gap-2">
      <FilterStrip
        testId="steering-grid-filter"
        query={facets.query}
        onQuery={(q) => setFacets((f) => ({ ...f, query: q }))}
        placeholder="Search id or statement…"
        chips={[
          { id: 'all', label: 'all', count: severityCounts.all ?? 0 },
          ...SEVERITIES.map((s) => ({ id: s, label: s, count: severityCounts[s] ?? 0 })),
        ]}
        active={facets.severity}
        onChip={(id) => setFacets((f) => ({ ...f, severity: id }))}
      >
        <button
          type="button"
          data-testid="steering-filter-retired"
          aria-pressed={facets.includeRetired}
          title="include_retired — retired rows stay listed (struck/dimmed); retire never deletes"
          onClick={() => setFacets((f) => ({ ...f, includeRetired: !f.includeRetired }))}
          style={{
            borderRadius: 'var(--radius-full)', padding: '3px 10px',
            fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', cursor: 'pointer',
            border: '1px solid',
            borderColor: facets.includeRetired ? 'var(--accent)' : 'var(--surface-raised)',
            background: facets.includeRetired ? 'var(--accent-subtle)' : 'transparent',
            color: facets.includeRetired ? 'var(--accent)' : 'var(--ink-muted)',
          }}
        >
          retired {facets.includeRetired ? 'shown' : 'hidden'}
        </button>
      </FilterStrip>

      {body()}

      {(draftIssue !== null || draftCollision) && draft !== null && (
        <p data-testid="steering-draft-issue" className="text-[10px]" style={{ color: draftIssue !== null ? 'var(--status-fail)' : 'var(--status-gate)' }}>
          {draftIssue ?? `id ${draft.id.trim()} already exists — saving will UPDATE that rule (the wire is an upsert)`}
        </p>
      )}
      {draft?.error != null && (
        <p data-testid="steering-draft-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {draft.error}
        </p>
      )}

      {!loading && error === null && draft === null && (
        <button
          type="button"
          data-testid="steering-grid-add"
          onClick={() => setDraft(freshDraft(rules, type))}
          className="self-start rounded px-2 py-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-1"
          style={{ color: 'var(--accent)', border: '1px dashed var(--surface-raised)' }}
        >
          + Add row
        </button>
      )}

      {retiring !== null && (
        <SteeringRetireModal
          rule={retiring}
          onClose={() => setRetiring(null)}
          onRetired={(reason) => {
            const rule = retiring;
            setRetiring(null);
            onRetired(rule, reason);
          }}
        />
      )}
    </div>
  );
}
