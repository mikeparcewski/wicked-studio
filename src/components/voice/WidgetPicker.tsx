import { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Ask } from '../../api/ask.js';
import { apiFetch } from '../../api/client.js';
import { AskCard } from '../ask/AskCard.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';
import { saveDashboard, useDashStore } from '../../voice/dashboardStore.js';
import {
  BUILTIN_WIDGETS, DEFAULT_LAYOUT, addWidgets, formatMetric, makeMetricWidget, metricFields, readMetric, removeWidget,
} from '../../voice/widgets.js';

/**
 * Add widgets to the voice dashboard, or make one (operator 2026-10-31). The picker is a guided pick-several (the
 * AskCard `pick` kind) over the widgets not on the dashboard: the built-ins, and the ones you made. "Make a metric
 * widget" builds a user plugin from one field of `GET /system` or `GET /diagnostics`, shown as a number or a chart.
 */
export function WidgetPicker({ onClose }: { onClose: () => void }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const { layout, widgets, saveError, storedIn } = useDashStore();
  const [building, setBuilding] = useState(false);
  useDialogFocus(true, ref, { modal: true, key: building });
  const on = layout ?? DEFAULT_LAYOUT;
  const available = [
    ...BUILTIN_WIDGETS.filter((b) => !on.includes(b.id)).map((b) => ({ id: b.id, label: b.title, sub: b.description })),
    ...widgets.filter((u) => !on.includes(u.id)).map((u) => ({ id: u.id, label: u.title, sub: `Made by you · ${u.metric.path}` })),
  ];
  const ask: Ask | null = available.length === 0 ? null : {
    id: 'voice-widgets-add', host: 'plugin', from: { kind: 'studio', id: 'voice', label: 'Voice dashboard' },
    prompt: 'Which widgets should be on your dashboard?', kind: 'pick', multi: { min: 1, max: available.length },
    answeredBy: 'person', record: 'Added: {labels}',
    options: available.map((a) => ({ id: a.id, label: a.label, sub: a.sub, token: a.id })),
  };
  return (
    <div className="wk-voice-sheet-scrim" data-testid="voice-picker-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        ref={ref}
        className="wk-voice-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={building ? 'Make a metric widget' : 'Add widgets'}
        data-testid="voice-picker"
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (building) setBuilding(false); else onClose(); } }}
      >
        <div className="wk-voice-sheet-h">
          <h2>{building ? 'Make a metric widget' : 'Add widgets'}</h2>
          <button type="button" className="wk-voice-x" aria-label="Close" data-testid="voice-picker-close" onClick={onClose}><X size={16} aria-hidden /></button>
        </div>
        {building ? <MetricBuilder onDone={() => { setBuilding(false); onClose(); }} onBack={() => setBuilding(false)} /> : (
          <>
            {ask !== null
              ? <AskCard ask={ask} header onAnswer={(a) => { void saveDashboard(addWidgets(layout, a.options ?? [])); onClose(); }} confirmLabel={() => 'Add to dashboard'} testIds={{ root: 'voice-picker-ask' }} />
              : <p className="wk-voice-small" data-testid="voice-picker-empty">Every widget is already on your dashboard.</p>}
            <div className="wk-voice-sheet-row">
              <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" data-testid="voice-make-widget" onClick={() => setBuilding(true)}>Make a metric widget</button>
              <span className="wk-voice-small">{storedIn === 'crew' ? 'Saved for you on this crew.' : 'Saved in this browser (this crew keeps no dashboards).'}</span>
            </div>
            {widgets.length > 0 && (
              <div className="wk-voice-mine" data-testid="voice-my-widgets">
                <h3>Widgets you made</h3>
                <ul>
                  {widgets.map((u) => (
                    <li key={u.id}>
                      <span>{u.title} <span className="wk-voice-small">· {u.metric.path}</span></span>
                      <button
                        type="button"
                        className="wk-btn wk-btn--secondary wk-btn--sm"
                        aria-label={`Delete the ${u.title} widget`}
                        data-testid={`voice-widget-delete-${u.id}`}
                        onClick={() => void saveDashboard(removeWidget(layout, u.id), widgets.filter((x) => x.id !== u.id))}
                      >Delete</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {saveError !== null && <p className="wk-voice-error" role="alert">{saveError}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function MetricBuilder({ onDone, onBack }: { onDone: () => void; onBack: () => void }): React.ReactElement {
  const { raw, layout, widgets } = useDashStore();
  const [source, setSource] = useState<'system' | 'diagnostics'>('system');
  const [diag, setDiag] = useState<unknown>(raw.diagnostics);
  const [filter, setFilter] = useState('');
  const [path, setPath] = useState('');
  const [title, setTitle] = useState('');
  const [display, setDisplay] = useState<'number' | 'chart'>('number');
  const [unit, setUnit] = useState('');
  const doc = source === 'system' ? raw.system : diag;
  const fields = useMemo(() => metricFields(doc), [doc]);
  const shown = fields.filter((f) => f.path.toLowerCase().includes(filter.trim().toLowerCase())).slice(0, 80);
  const value = path !== '' ? readMetric(doc, path) : null;
  const pickSource = (s: 'system' | 'diagnostics'): void => {
    setSource(s); setPath('');
    if (s === 'diagnostics' && diag === null) void apiFetch<unknown>('/diagnostics').then(setDiag, () => setDiag(null));
  };
  const canSave = path !== '' && title.trim() !== '';
  return (
    <form
      className="wk-voice-builder"
      data-testid="voice-builder"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const m = makeMetricWidget({ title, source, path, display, unit, taken: widgets.map((w) => w.id) });
        void saveDashboard(addWidgets(layout, [m.id]), [...widgets, m]);
        onDone();
      }}
    >
      <fieldset>
        <legend>Read from</legend>
        <label><input type="radio" name="vw-src" checked={source === 'system'} onChange={() => pickSource('system')} /> The system (/system)</label>
        <label><input type="radio" name="vw-src" checked={source === 'diagnostics'} onChange={() => pickSource('diagnostics')} /> Crew’s diagnostics (/diagnostics)</label>
      </fieldset>
      <label className="wk-voice-field">
        <span>Field</span>
        <input data-testid="voice-builder-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter fields: load, disk, runs…" />
      </label>
      <select
        className="wk-voice-fields"
        data-testid="voice-builder-field"
        size={6}
        aria-label="Field"
        value={path}
        onChange={(e) => { setPath(e.target.value); if (title.trim() === '') setTitle(defaultTitle(e.target.value)); }}
      >
        {shown.map((f) => <option key={f.path} value={f.path}>{f.path} = {formatMetric(f.value)}</option>)}
      </select>
      {doc === null && <p className="wk-voice-small">Nothing read yet from this source.</p>}
      <label className="wk-voice-field">
        <span>Title</span>
        <input data-testid="voice-builder-title" value={title} maxLength={40} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <fieldset>
        <legend>Show it as</legend>
        <label><input type="radio" name="vw-disp" checked={display === 'number'} onChange={() => setDisplay('number')} /> A number</label>
        <label><input type="radio" name="vw-disp" data-testid="voice-builder-chart" checked={display === 'chart'} onChange={() => setDisplay('chart')} /> A chart of recent readings</label>
      </fieldset>
      <label className="wk-voice-field">
        <span>Unit (optional)</span>
        <input value={unit} maxLength={12} onChange={(e) => setUnit(e.target.value)} placeholder="GB, runs, %" />
      </label>
      <p className="wk-voice-preview" data-testid="voice-builder-preview" aria-live="polite">
        {path === '' ? 'Pick a field to see its value.' : `${title.trim() || 'Untitled'}: ${value === null ? 'no value now' : formatMetric(value)}${unit.trim() !== '' ? ` ${unit.trim()}` : ''}`}
      </p>
      <div className="wk-voice-sheet-row">
        <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={onBack}>Back</button>
        <button type="submit" className="wk-btn wk-btn--primary wk-btn--sm" data-testid="voice-builder-save" disabled={!canSave}>Add this widget</button>
      </div>
    </form>
  );
}

function defaultTitle(path: string): string {
  const last = path.split('.').filter((s) => s !== 'length' && s !== 'details').at(-1) ?? 'Metric';
  const name = last.replace(/\[.*?=(.*?)\]/, ' $1').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 40);
}
