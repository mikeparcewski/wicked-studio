import { Plus, X } from 'lucide-react';
import type { SystemSnapshot } from '../../api/system.js';
import type { VoiceWidgetManifest } from '../../api/voice.js';
import { useWindowSpend } from '../../hooks/useWindowSpend.js';
import { useGateStore } from '../../store/gates.js';
import { useVoiceStore } from '../../store/voice.js';
import { saveDashboard, useDashStore } from '../../voice/dashboardStore.js';
import { formatMetric, readMetric, removeWidget, type DashboardWidget } from '../../voice/widgets.js';

/**
 * The live system around the transcript (mockup state g): built-in widgets (machine load, health, helpers, running
 * jobs, waiting decisions, today's cost) and the person's own metric widgets. Every widget can be removed from its
 * own header; "Add widget" opens the picker. Each is a plugin's `voice-dashboard` section (`voice/widgets.ts`).
 */
export function WidgetTile({ w, children, alert = false, summary }: { w: DashboardWidget; children: React.ReactNode; alert?: boolean; summary?: string }): React.ReactElement {
  const layout = useDashStore((s) => s.layout);
  return (
    <section className="wk-voice-tile" data-testid={`voice-widget-${w.id}`} data-widget={w.id} data-alert={alert ? 'true' : undefined} aria-label={w.title}>
      <h3>
        <span>{w.title}</span>
        {summary !== undefined && <span className="sr-only">{summary}</span>}
        <button
          type="button"
          className="wk-voice-tile-x"
          aria-label={`Remove the ${w.title} widget`}
          data-testid={`voice-widget-remove-${w.id}`}
          onClick={() => void saveDashboard(removeWidget(layout, w.id))}
        >
          <X size={12} aria-hidden />
        </button>
      </h3>
      {children}
    </section>
  );
}

function Spark({ values, tone = 'warn' }: { values: readonly number[]; tone?: 'warn' | 'accent' }): React.ReactElement | null {
  if (values.length < 2) return null;
  // Readings relative to their own range (a flat line sits mid-height), so a small change is visible.
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const h = (v: number): number => (hi === lo ? 50 : Math.round(15 + ((v - lo) / (hi - lo)) * 85));
  return (
    <div className="wk-voice-spark" data-tone={tone} aria-hidden>
      {values.map((v, i) => <i key={i} style={{ height: `${h(v)}%` }} />)}
    </div>
  );
}

/** One shared empty history: a fresh `[]` from a store selector would re-render forever. */
const NONE: readonly number[] = [];

const Dot = ({ tone }: { tone: 'ok' | 'run' | 'warn' | 'fail' | 'idle' }): React.ReactElement => <span className="wk-voice-dot" data-tone={tone} aria-hidden />;

function LoadWidget({ w, snap }: { w: DashboardWidget; snap: SystemSnapshot | null }): React.ReactElement {
  const row = snap?.infra.find((i) => i.key === 'load');
  const hist = useDashStore((s) => s.history['load'] ?? NONE);
  const load = row?.load;
  const word = row?.state === 'down' ? 'saturated' : row?.state === 'degraded' ? 'busy' : row?.state === 'ok' ? 'calm' : 'not read';
  return (
    <WidgetTile w={w}>
      {load !== null && load !== undefined ? (
        <><span className="wk-voice-big">load {formatMetric(Math.round(load.load1))}</span> <span className="wk-voice-small">{load.cores !== null ? `of ${load.cores} cores · ` : ''}{word}</span></>
      ) : <span className="wk-voice-small">{row?.reason ?? 'Not read yet'}</span>}
      <Spark values={hist} />
    </WidgetTile>
  );
}

function HealthWidget({ w, snap }: { w: DashboardWidget; snap: SystemSnapshot | null }): React.ReactElement {
  const rows = snap?.infra ?? [];
  const counted = rows.filter((r) => r.state !== 'off' && r.state !== 'unknown');
  const up = counted.filter((r) => r.state === 'ok').length;
  const down = counted.filter((r) => r.state === 'down');
  return (
    <WidgetTile w={w}>
      {snap === null ? <span className="wk-voice-small">Not read yet</span> : (
        <>
          <span className="wk-voice-big"><Dot tone={down.length > 0 ? 'fail' : up === counted.length ? 'ok' : 'warn'} />{up} of {counted.length}</span> <span className="wk-voice-small">services up</span>
          {down.length > 0 && <p className="wk-voice-small">Down: {down.map((d) => d.name).join(', ')}</p>}
        </>
      )}
    </WidgetTile>
  );
}

function HelpersWidget({ w, snap }: { w: DashboardWidget; snap: SystemSnapshot | null }): React.ReactElement {
  const clis = (snap?.clis ?? []).filter((c) => c.state === 'signed_in');
  const busy = (key: string): string | null => {
    const r = snap?.runs.find((x) => x.seat === key && (x.liveness === 'working' || x.liveness === 'quiet'));
    return r === undefined ? null : r.phase ?? 'working';
  };
  return (
    <WidgetTile w={w}>
      {clis.length === 0 ? <span className="wk-voice-small">{snap === null ? 'Not read yet' : 'No helper is signed in'}</span> : (
        <ul className="wk-voice-list">
          {clis.slice(0, 5).map((c) => { const b = busy(c.key); return <li key={c.key}><Dot tone={b !== null ? 'run' : 'ok'} />{c.name} · {b ?? 'free'}</li>; })}
        </ul>
      )}
    </WidgetTile>
  );
}

function JobsWidget({ w, snap }: { w: DashboardWidget; snap: SystemSnapshot | null }): React.ReactElement {
  const runs = (snap?.runs ?? []).filter((r) => r.liveness !== 'held');
  const tone = (l: string): 'run' | 'warn' | 'fail' => (l === 'stalled' ? 'fail' : l === 'waiting_on_you' ? 'warn' : 'run');
  return (
    <WidgetTile w={w}>
      {runs.length === 0 ? <span className="wk-voice-small">{snap === null ? 'Not read yet' : 'Nothing running'}</span> : (
        <ul className="wk-voice-list">
          {runs.slice(0, 4).map((r) => <li key={r.runId}><Dot tone={tone(r.liveness)} /><span className="wk-voice-ellip">{r.title}</span>{r.phase !== null ? <span className="wk-voice-small"> · {r.phase}</span> : null}</li>)}
          {runs.length > 4 && <li className="wk-voice-small">and {runs.length - 4} more</li>}
        </ul>
      )}
    </WidgetTile>
  );
}

function GatesWidget({ w, snap }: { w: DashboardWidget; snap: SystemSnapshot | null }): React.ReactElement {
  const gates = useGateStore((s) => s.gates);
  const awaiting = useVoiceStore((s) => s.awaitingGate);
  const open = Object.values(gates);
  const first = open[0];
  const title = first !== undefined ? snap?.runs.find((r) => r.runId === first.runId)?.title ?? null : null;
  return (
    <WidgetTile w={w} alert={awaiting !== null} summary={`${open.length} waiting`}>
      <span className="wk-voice-big" data-testid="voice-gates-count">{open.length}</span>{' '}
      <span className="wk-voice-small">{open.length === 1 ? `decision${title !== null ? ` · ${title}` : ''}` : 'decisions'}</span>
    </WidgetTile>
  );
}

function SpendWidget({ w }: { w: DashboardWidget }): React.ReactElement {
  const spend = useWindowSpend(1);
  return (
    <WidgetTile w={w}>
      <span className="wk-voice-big">{spend.current !== null ? `$${spend.current.toFixed(2)}` : spend.phase === 'loading' ? '…' : 'not priced'}</span>{' '}
      <span className="wk-voice-small">last 24 h{spend.partial ? ' · some work unpriced' : ''}</span>
    </WidgetTile>
  );
}

/** A user plugin: one field, as a number or a chart of its recent readings. */
export function MetricWidget({ w, manifest }: { w: DashboardWidget; manifest: VoiceWidgetManifest }): React.ReactElement {
  const raw = useDashStore((s) => (manifest.metric.source === 'system' ? s.raw.system : s.raw.diagnostics));
  const hist = useDashStore((s) => s.history[`${manifest.metric.source}:${manifest.metric.path}`] ?? NONE);
  const v = readMetric(raw, manifest.metric.path);
  return (
    <WidgetTile w={w}>
      <span className="wk-voice-big">{v === null ? '—' : formatMetric(v)}</span>
      {manifest.metric.unit !== undefined && <span className="wk-voice-small"> {manifest.metric.unit}</span>}
      {v === null && <p className="wk-voice-small">{raw === null ? 'Not read yet' : 'This field is not in the latest read'}</p>}
      {manifest.metric.display === 'chart' && <Spark values={hist} tone="accent" />}
      <p className="wk-voice-small wk-voice-src">Made by you · /{manifest.metric.source}</p>
    </WidgetTile>
  );
}

export function Widget({ w }: { w: DashboardWidget }): React.ReactElement {
  const snap = useDashStore((s) => s.system);
  if (w.kind === 'user') return <MetricWidget w={w} manifest={w.manifest} />;
  switch (w.id) {
    case 'builtin.load': return <LoadWidget w={w} snap={snap} />;
    case 'builtin.health': return <HealthWidget w={w} snap={snap} />;
    case 'builtin.helpers': return <HelpersWidget w={w} snap={snap} />;
    case 'builtin.jobs': return <JobsWidget w={w} snap={snap} />;
    case 'builtin.gates': return <GatesWidget w={w} snap={snap} />;
    default: return <SpendWidget w={w} />;
  }
}

export function AddWidgetButton({ onOpen }: { onOpen: () => void }): React.ReactElement {
  return (
    <button type="button" className="wk-voice-add" data-testid="voice-widget-add" onClick={onOpen}>
      <Plus size={14} aria-hidden /> Add widget
    </button>
  );
}
