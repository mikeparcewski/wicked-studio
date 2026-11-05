import { useEffect, useState } from 'react';
import type { AppSpec } from '../../api/types.js';

/**
 * PROPERTIES, in the app's side panel (operator 2026-11-04: "chat/properties should be in same panel just tabs"): the
 * fields K4's runtime drew in its own Properties column, drawn by the HOST for the component selected in Edit. Every
 * change is one of the runtime's own ops (`component-set`, `bind`, `component-move`, `component-resize`,
 * `component-remove`), applied to the app's session (one version per edit burst, as a drag), and the runtime is told
 * to read the spec again. A text field lands on Enter or when it is left; a choice at once.
 */

type Op = Record<string, unknown>;
type Comp = AppSpec['pages'][number]['components'][number];

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return <label className="wk-appprops-row"><span className="wk-appprops-label">{label}</span>{children}</label>;
}

/** A text field that keeps the person's typing until they leave it or press Enter (then one op). */
function TextField({ label, value, max, area = false, prop, onCommit, testId }: { label: string; value: string; max: number; area?: boolean; prop: string; onCommit: (v: string) => void; testId: string }): React.ReactElement {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = (): void => { if (v !== value) onCommit(v); };
  const common = {
    className: 'wk-input', value: v, maxLength: max, 'data-prop': prop, 'data-testid': testId,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => { if ((e.nativeEvent as KeyboardEvent).isComposing) return; if (e.key === 'Enter' && (!area || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); } },
  };
  return <Field label={label}>{area ? <textarea rows={4} {...common} /> : <input {...common} />}</Field>;
}

function NumField({ label, value, min, max, prop, onCommit }: { label: string; value: number; min: number; max: number; prop: string; onCommit: (v: number) => void }): React.ReactElement {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const commit = (): void => {
    if (v.trim() === '') { setV(String(value)); return; }
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) { setV(String(value)); return; }
    const c = Math.min(max, Math.max(min, n));
    if (c !== value) onCommit(c); else setV(String(value));
  };
  return (
    <Field label={label}>
      <input className="wk-input wk-input--num" type="number" min={min} max={max} value={v} data-prop={prop}
        onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
    </Field>
  );
}

function SelectField({ label, value, options, prop, onPick }: { label: string; value: string; options: readonly string[]; prop: string; onPick: (v: string) => void }): React.ReactElement {
  return (
    <Field label={label}>
      <select className="wk-input" value={value} data-prop={prop} onChange={(e) => onPick(e.target.value)}>
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </Field>
  );
}

const TYPE_WORD: Record<string, string> = { kpi: 'KPI', table: 'table', chart: 'chart', text: 'text', filter: 'filter', form: 'form', button: 'button', image: 'image', link: 'link' };

/**
 * The App group (DES-REPORT-DASHBOARDS-001 §2, rev 4): the app's own settings, at the top of Properties whenever no
 * component is selected, in Preview and in Edit alike. Its controls are not spec ops, so it has its own permission:
 * component editing (`editable`) never gates it.
 */
function AppGroup({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <section className="wk-appprops-app" data-testid="app-properties-app" aria-label="App">
      <h3 className="wk-appprops-app-title">App</h3>
      {children}
    </section>
  );
}

export function AppProperties({ spec, selected, editable, readOnlyWhy, onOps, app = null }: {
  spec: AppSpec | null;
  /** The component selected in Edit (its id), or null. */
  selected: string | null;
  /** Edit is open and the app takes changes here (not framed, not a phone, no turn in flight). */
  editable: boolean;
  /** Why nothing can be changed here, when it cannot. */
  readOnlyWhy: string | null;
  /** Apply ops to the app's session; the answer says whether they were taken. */
  onOps: (ops: Op[]) => { ok: boolean; message?: string };
  /** The App group's controls (Show on Report), shown with no component selected; null for none. */
  app?: React.ReactNode;
}): React.ReactElement {
  const [note, setNote] = useState<string | null>(null);
  const c: Comp | undefined = selected === null ? undefined : spec?.pages.flatMap((p) => p.components).find((x) => x.id === selected);
  useEffect(() => { setNote(null); }, [selected]);
  const group = app !== null && c === undefined ? <AppGroup>{app}</AppGroup> : null;
  if (!editable) {
    return (
      <div className="wk-appprops" data-testid="app-properties">
        {group}
        <p className="wk-appprops-empty" data-testid="app-properties-empty">{readOnlyWhy ?? 'Open Edit to change a component here: select it on the canvas.'}</p>
      </div>
    );
  }
  if (c === undefined) {
    return (
      <div className="wk-appprops" data-testid="app-properties">
        {group}
        <p className="wk-appprops-empty" data-testid="app-properties-empty">Select a component on the canvas to change it here. Double-click its words to edit them in place.</p>
      </div>
    );
  }
  const apply = (ops: Op[]): void => {
    const r = onOps(ops);
    setNote(r.ok ? null : `Not changed: ${r.message ?? 'the app did not take it'}`);
  };
  const set = (prop: string, value: unknown): void => apply([{ op: 'component-set', id: c.id, prop, value }]);
  const queries = (spec?.queries ?? []).map((q) => q.id);
  const cols = (q: string): string[] => spec?.queries.find((x) => x.id === q)?.output.map((o) => o.name) ?? [];
  const k = c as unknown as Record<string, unknown> & { box: { x: number; y: number; w: number; h: number } };
  const data = (k['data'] as { query?: string } | undefined)?.query ?? '';
  const str = (name: string): string => (typeof k[name] === 'string' ? (k[name] as string) : '');
  return (
    <div className="wk-appprops" data-testid="app-properties" data-component={c.id}>
      <p className="wk-appprops-what" data-testid="app-properties-what">{c.type === 'chart' ? `${str('chart')} chart` : TYPE_WORD[c.type] ?? c.type} · {c.id}</p>
      <TextField label="Title" value={str('title')} max={120} prop="title" testId="app-prop-title" onCommit={(v) => set('title', v)} />
      {(c.type === 'table' || c.type === 'chart' || c.type === 'kpi') && (
        <SelectField label="Data" value={data} options={queries} prop="query" onPick={(v) => apply([{ op: 'bind', id: c.id, query: v }])} />
      )}
      {c.type === 'table' && <NumField label="Rows per page" value={typeof k['pageSize'] === 'number' ? k['pageSize'] as number : 10} min={5} max={500} prop="pageSize" onCommit={(v) => set('pageSize', v)} />}
      {c.type === 'chart' && (
        <>
          <SelectField label="Chart" value={str('chart')} options={['bar', 'line', 'area', 'pie']} prop="chart" onPick={(v) => set('chart', v)} />
          <SelectField label="Category" value={str('x')} options={cols(data)} prop="x" onPick={(v) => set('x', v)} />
          {(str('chart') === 'bar' || str('chart') === 'area') && (
            <Field label="Stacked"><input type="checkbox" className="wk-check" data-prop="stacked" checked={k['stacked'] === true} onChange={(e) => set('stacked', e.target.checked)} /></Field>
          )}
        </>
      )}
      {c.type === 'kpi' && (
        <>
          <SelectField label="Figure" value={str('value')} options={cols(data)} prop="value" onPick={(v) => set('value', v)} />
          <TextField label="Caption" value={str('caption')} max={120} prop="caption" testId="app-prop-caption" onCommit={(v) => set('caption', v)} />
        </>
      )}
      {c.type === 'text' && (
        <>
          <TextField label="Text" value={str('text')} max={4000} area prop="text" testId="app-prop-text" onCommit={(v) => set('text', v)} />
          <SelectField label="Style" value={str('style') || 'body'} options={['heading', 'body', 'caption']} prop="style" onPick={(v) => set('style', v)} />
        </>
      )}
      {(c.type === 'filter' || c.type === 'link') && <TextField label="Label" value={str('label')} max={120} prop="label" testId="app-prop-label" onCommit={(v) => set('label', v)} />}
      {c.type === 'button' && <TextField label="Label" value={(k['action'] as { label?: string } | undefined)?.label ?? ''} max={60} prop="label" testId="app-prop-label" onCommit={(v) => set('label', v)} />}
      {c.type === 'image' && <TextField label="Description" value={str('alt')} max={300} prop="alt" testId="app-prop-alt" onCommit={(v) => set('alt', v)} />}
      <div className="wk-appprops-box">
        <NumField label="Column" value={k.box.x + 1} min={1} max={12} prop="box-x" onCommit={(v) => apply([{ op: 'component-move', id: c.id, x: Math.min(12 - k.box.w, Math.max(0, v - 1)), y: k.box.y }])} />
        <NumField label="Row" value={k.box.y + 1} min={1} max={1000} prop="box-y" onCommit={(v) => apply([{ op: 'component-move', id: c.id, x: k.box.x, y: Math.max(0, v - 1) }])} />
        <NumField label="Width" value={k.box.w} min={1} max={12} prop="box-w" onCommit={(v) => apply([{ op: 'component-resize', id: c.id, w: Math.min(12 - k.box.x, Math.max(1, v)), h: k.box.h }])} />
        <NumField label="Height" value={k.box.h} min={1} max={50} prop="box-h" onCommit={(v) => apply([{ op: 'component-resize', id: c.id, w: k.box.w, h: Math.min(50, Math.max(1, v)) }])} />
      </div>
      <Field label="Hide on phones"><input type="checkbox" className="wk-check" data-prop="hideOnPhone" checked={k['hideOnPhone'] === true} onChange={(e) => set('hideOnPhone', e.target.checked)} /></Field>
      <button type="button" className="wk-btn wk-btn--danger" data-testid="app-prop-remove" onClick={() => apply([{ op: 'component-remove', id: c.id }])}>Delete this component</button>
      {note !== null && <p className="wk-appprops-note" data-testid="app-properties-note" role="status">{note}</p>}
    </div>
  );
}
