import { useEffect, useId, useRef, useState } from 'react';
import { useProjectsStore } from '../../store/projects.js';
import { ADMIN_WHY, FRAMED_WHY, framing, REPORT_MAX, shownName, UNREAD_WHY, useReportShown, type ShownVerdict } from '../../store/reportShown.js';

/**
 * SHOW ON REPORT (DES-REPORT-DASHBOARDS-001 §2, rev 4; operator 2026-11-04: "a show as report option in apps so it can
 * show up there without showing all applications"): the one switch, drawn in the app's Properties (nothing selected)
 * and in its Apps card's ⋯ menu, and the Unpin on a Report card. All three go through the store's one writer, so they
 * agree: the switch moves only once crew confirmed the change, shows "Changing…" while it waits, and says why when it
 * did not change. It is read-only (with the reason) while the list is being read, when it could not be read, in a
 * framed studio, and when only an admin may change it; with the cap full it is disabled for an app not on, naming the
 * 4 that are, with Manage shown dashboards.
 */

/** Insight → Report, at its dashboards: where the 4 shown can be turned off, from every project. */
export const MANAGE_PATH = '/report?focus=dashboards';

/** "Mikes’ Report", "Support’s Report". */
export function reportOf(projectName: string): string {
  return /s$/u.test(projectName) ? `${projectName}’ Report` : `${projectName}’s Report`;
}

export interface ShownSwitch {
  on: boolean;
  busy: boolean;
  /** The last change that did not land (ok clears it). */
  verdict: ShownVerdict | null;
  /** Why the control can't change anything now, or null. */
  readOnlyWhy: string | null;
  /** The cap is full and this app is not on: the names of the 4 that are. */
  fullNames: string[] | null;
  shownCount: number;
  shared: boolean;
  loadFailed: boolean;
  change: (on: boolean) => void;
  /** Try the last change again: the same intent, against the list as it is then. */
  retry: () => void;
  reload: () => void;
}

/** One control's view of the shown list and its writer (each control keeps its own pending state). */
export function useShownSwitch(slug: string, framedHere = false): ShownSwitch {
  const load = useReportShown((s) => s.load);
  const readOk = useReportShown((s) => s.readOk);
  const shown = useReportShown((s) => s.shown);
  const refused = useReportShown((s) => s.refused);
  const shared = useReportShown((s) => s.shared);
  const apps = useReportShown((s) => s.apps);
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ShownVerdict | null>(null);
  const last = useRef<boolean | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; void useReportShown.getState().loadShown(); return () => { alive.current = false; }; }, []);
  const on = shown.includes(slug);
  const full = !on && shown.length >= REPORT_MAX;
  const fullVerdict = verdict?.kind === 'full';
  useEffect(() => { if (full || fullVerdict) void useReportShown.getState().loadApps(); }, [full, fullVerdict]);
  const framed = framedHere || framing.framed();
  const readOnlyWhy = framed ? FRAMED_WHY : refused ? ADMIN_WHY : load === 'failed' ? UNREAD_WHY : !readOk ? 'Reading what shows on Report…' : null;
  const change = (want: boolean): void => {
    if (busy || readOnlyWhy !== null) return;
    last.current = want;
    setBusy(true);
    setVerdict(null);
    void useReportShown.getState().setShown(slug, want).then((v) => {
      if (!alive.current) return;
      setBusy(false);
      setVerdict(v.kind === 'ok' ? null : v);
    });
  };
  return {
    on, busy, verdict, readOnlyWhy, shownCount: shown.length, shared,
    fullNames: full ? shown.map((s) => shownName(s, apps)) : null,
    loadFailed: load === 'failed',
    change,
    retry: () => { if (last.current !== null) change(last.current); },
    reload: () => { void useReportShown.getState().loadShown(true); },
  };
}

/** A change that did not land, in words ("<name> wasn't changed: <reason>"). */
export function verdictWords(v: ShownVerdict, name: string, names: (slugs: readonly string[]) => string[]): string {
  if (v.kind === 'full') return `Report shows ${REPORT_MAX} dashboards; turn one off first: ${names(v.shown).join(', ')}.`;
  if (v.kind === 'refused') return v.reason;
  if (v.kind === 'ok') return '';
  return `${name} wasn’t changed: ${v.reason}`;
}

export function ShowOnReport({ slug, name, projectId, variant, navigate, framed = false }: {
  slug: string;
  name: string;
  /** The app's project (its Report is the one it shows on). */
  projectId: string | null;
  /** In the app's Properties, or in its Apps card's ⋯ menu. */
  variant: 'properties' | 'menu';
  navigate?: (path: string) => void;
  framed?: boolean;
}): React.ReactElement {
  const sw = useShownSwitch(slug, framed);
  const apps = useReportShown((s) => s.apps);
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { const p = useProjectsStore.getState(); if (p.projects.length === 0 && !p.loading) void p.load(); }, []);
  const id = useId();
  const projectName = projectId === null ? null : projects.find((p) => p.id === projectId)?.name ?? null;
  const where = `${projectName !== null ? reportOf(projectName) : 'its project’s Report'} and on Insight → Report`;
  const help = `${variant === 'properties' ? 'Shows this dashboard’s live numbers on' : 'Shows it on'} ${where}.${sw.readOnlyWhy === null ? ` ${sw.shownCount} of ${REPORT_MAX} shown.` : ''}${sw.shared ? ' Shared: everyone signed in to this crew sees the same Report.' : ''}`;
  const disabledWhy = sw.readOnlyWhy ?? (sw.fullNames !== null ? `Report shows ${REPORT_MAX} dashboards; turn one off first: ${sw.fullNames.join(', ')}.` : null);
  const state = sw.busy ? 'pending' : sw.readOnlyWhy !== null ? 'readonly' : sw.fullNames !== null ? 'full' : sw.on ? 'on' : 'off';
  const names = (slugs: readonly string[]): string[] => slugs.map((s) => shownName(s, apps));
  const manage = (
    <a href={MANAGE_PATH} className="wk-link wk-sor-manage" data-testid="show-on-report-manage" onClick={(e) => { if (navigate === undefined) return; e.preventDefault(); navigate(MANAGE_PATH); }}>Manage shown dashboards</a>
  );
  return (
    <div className="wk-sor" data-testid="show-on-report" data-state={state} data-variant={variant}>
      <div className="wk-sor-row">
        <span id={`${id}-l`} className="wk-sor-label">Show on Report</span>
        <button type="button" role="switch" className="wk-sor-switch" data-testid="show-on-report-switch" aria-labelledby={`${id}-l`} aria-describedby={[...(sw.busy || sw.fullNames === null ? [`${id}-h`] : []), ...(disabledWhy !== null ? [`${id}-w`] : [])].join(' ') || undefined}
          aria-checked={sw.on} aria-busy={sw.busy ? 'true' : undefined} disabled={sw.busy || disabledWhy !== null} onClick={() => sw.change(!sw.on)}>
          <span className="wk-sor-thumb" aria-hidden />
        </button>
      </div>
      {/* With the cap full the reason stands alone (the mockup's full state), and still describes the switch. */}
      {(sw.busy || sw.fullNames === null) && <p id={`${id}-h`} className="wk-sor-help" data-testid="show-on-report-help">{sw.busy ? 'Changing…' : help}</p>}
      {disabledWhy !== null && (
        <p id={`${id}-w`} className="wk-sor-why" data-testid="show-on-report-why" data-tone={sw.fullNames !== null || sw.loadFailed ? 'warn' : undefined}>
          {disabledWhy}
          {sw.loadFailed && <>{' '}<button type="button" className="wk-btn wk-btn--link" data-testid="show-on-report-reload" onClick={sw.reload}>Try again</button></>}
        </p>
      )}
      {sw.fullNames !== null && sw.readOnlyWhy === null && manage}
      {sw.verdict !== null && (
        <p className="wk-sor-why" data-testid="show-on-report-verdict" data-verdict={sw.verdict.kind} data-tone="warn" role="status">
          {verdictWords(sw.verdict, name, names)}
          {(sw.verdict.kind === 'failed' || sw.verdict.kind === 'dropped') && <>{' '}<button type="button" className="wk-btn wk-btn--link" data-testid="show-on-report-retry" onClick={sw.retry}>Try again</button></>}
        </p>
      )}
      {sw.verdict?.kind === 'full' && manage}
    </div>
  );
}
