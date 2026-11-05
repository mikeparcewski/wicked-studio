import { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
// The registry's read only (the sources API, with its writes, stays the sources components' alone).
import { reportOrigin, type AppOrigin } from '../../editors/apps/appOrigin.js';
import { dashboardSeeds } from '../../editors/apps/appSeeds.js';
import type { KnowledgeSummary } from '../../api/knowledgeSummary.js';
import { readSuggestionGrounds } from '../../editors/apps/suggestionGrounds.js';
import { dataSeedsBeside, knowledgeSeeds, mixSeeds } from '../../editors/apps/knowledgeSeeds.js';
import { nameFrom } from '../../editors/apps/appTurns.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useProjectsStore } from '../../store/projects.js';
import { REPORT_MAX, shownName, UNREAD_WHY, useReportShown, type ShownVerdict } from '../../store/reportShown.js';
import { appPath } from '../apps/AppCard.js';
import { NewAppChat } from '../apps/NewAppChat.js';
import { verdictWords } from '../apps/ShowOnReport.js';
import { useModalEscape } from '../Modal.js';
import { useDialogFocus } from '../steer/useDialogFocus.js';

/**
 * BUILD A DASHBOARD, from Report (DES-REPORT-DASHBOARDS-001 §2 "Entry", "Seeds", "Project", "Building"): the K5
 * composer in a sheet, seeded with fixed sentences filled only with Report's period and the names of the sources the
 * chosen project can see. A project's Report locks the app to that project; Insight → Report offers stored, active
 * projects and sends nothing until one is chosen.
 *
 * Once crew has made the app (its first message sent or not), the one writer adds it to the shown list, so a dashboard
 * built here starts with Show on Report on; the app opens only after that is confirmed. Any other verdict keeps the
 * sheet open: "Made <name>, but it isn't on Report: <reason>", Try again (the settings write only) and Open it. With
 * the cap already full when it is sent, the sheet says so first; it then makes the app once, writes nothing and opens
 * it. Nothing here ever makes a second app.
 */

/** `summary`: the project's knowledge summary, `null` when crew has none (then no source is named). */
type Sources = { state: 'none' } | { state: 'reading'; project: string }
  | { state: 'failed'; project: string; why: string; summary: KnowledgeSummary | null }
  | { state: 'ok'; project: string; names: string[]; readable: boolean; summary: KnowledgeSummary | null };

interface Made { slug: string; name: string; verdict: ShownVerdict; busy: boolean }

/**
 * The one Build in flight, kept OUTSIDE the sheet (xreview r1): closing the sheet while crew makes the app neither
 * loses the operation nor lets a reopened sheet send a second one. The app it makes is still put on Report; it opens
 * only while a sheet is open (a dismissed sheet never navigates), and a reopened sheet shows where it stands.
 */
interface BuildRun {
  creating: boolean;
  made: Made | null;
  /** Why the last attempt made no app (crew's words), for a sheet reopened after it. */
  failNote: string | null;
  /** The cap was full when the message was sent: the app is made once, and nothing is written. */
  fullAtSend: boolean;
  /** The Report the Build was sent from: the app opens with ITS way back, whichever sheet is open then. */
  origin: AppOrigin | null;
  /** The open sheet's navigation (null while none is open: a dismissed sheet never navigates). */
  opener: Navigate | null;
}
export const useBuildRun = create<BuildRun>(() => ({ creating: false, made: null, failNote: null, fullAtSend: false, origin: null, opener: null }));

function openApp(slug: string): boolean {
  const { opener, origin } = useBuildRun.getState();
  if (opener === null) return false;
  opener(appPath(slug, 'preview', origin));
  return true;
}

/** Put the made app on Report (the one writer), then open it; any other verdict is kept for the sheet to say. */
async function pin(slug: string, name: string): Promise<void> {
  useBuildRun.setState({ made: { slug, name, verdict: { kind: 'ok', shown: [] }, busy: true } });
  // The first read may still be in flight (it is awaited, never skipped), or have failed (read again).
  const st = useReportShown.getState();
  await st.loadShown(st.load === 'failed');
  const verdict = await useReportShown.getState().setShown(slug, true);
  if (verdict.kind === 'ok') {
    useBuildRun.setState({ made: null });
    openApp(slug);
    return;
  }
  useBuildRun.setState({ made: { slug, name, verdict, busy: false } });
}

/** TESTS. */
export function resetBuildRun(): void { useBuildRun.setState({ creating: false, made: null, failNote: null, fullAtSend: false, origin: null, opener: null }); }

export function BuildDashboardSheet({ projectId, period, navigate, onClose, framed }: {
  /** A project's Report (locks the project); undefined = Insight → Report. */
  projectId?: string | undefined;
  /** Report's period, in studio's words ("Last 7 days"). */
  period: string;
  navigate: Navigate;
  onClose: () => void;
  framed: boolean;
}): React.ReactElement {
  const box = useRef<HTMLDivElement | null>(null);
  useModalEscape(onClose);
  useDialogFocus(true, box, { modal: true });
  const shown = useReportShown((s) => s.shown);
  const load = useReportShown((s) => s.load);
  const apps = useReportShown((s) => s.apps);
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { void useReportShown.getState().loadShown(); }, []);
  const full = shown.length >= REPORT_MAX;
  useEffect(() => { if (full) void useReportShown.getState().loadApps(); }, [full]);
  const lock = projectId !== undefined && projectId !== 'default' ? projectId : null;
  const origin = reportOrigin(lock ?? undefined);

  // The sources the chosen project's dashboards can be built on, and what it KNOWS (DES-KNOWLEDGE-DATA-001 §9.1): read
  // together, again on every project change; an answer for an earlier choice (out of order) is dropped. A source is
  // named only when the project's knowledge summary lists it and an app query can read it (`dataSourcesFor`), the
  // same rule as the Apps page.
  const [sources, setSources] = useState<Sources>({ state: 'none' });
  const gen = useRef(0);
  const onProject = useCallback((id: string | null) => {
    const g = ++gen.current;
    if (id === null) { setSources({ state: 'none' }); return; }
    setSources({ state: 'reading', project: id });
    void readSuggestionGrounds(id).then((r) => {
      if (g !== gen.current) return;
      setSources(r.servers !== null ? { state: 'failed', project: id, why: r.servers.failed, summary: r.summary } : { state: 'ok', project: id, names: r.data, readable: r.readable ?? true, summary: r.summary });
    });
  }, []);
  const names = sources.state === 'ok' ? sources.names : [];
  const summary = sources.state === 'ok' || sources.state === 'failed' ? sources.summary : null;
  const known = summary !== null && sources.state !== 'none' && summary.projectId === sources.project ? knowledgeSeeds(summary) : [];
  const seeds = sources.state === 'reading' || sources.state === 'none' ? []
    : mixSeeds(known, dataSeedsBeside(known, dashboardSeeds(period, names), sources.state === 'ok' ? sources.readable : null));
  const chosenName = sources.state === 'none' ? null : projects.find((p) => p.id === sources.project)?.name ?? sources.project;

  const run = useBuildRun();
  const made = run.made;
  const open = (slug: string): void => navigate(appPath(slug, 'preview', run.origin ?? origin));
  useEffect(() => {
    useBuildRun.setState({ opener: navigate });
    return () => useBuildRun.setState({ opener: null });
  }, [navigate]);
  // A finished verdict belongs to the sheet that showed it: opening a sheet, or closing one, starts fresh (xreview r2:
  // a verdict reached while no sheet was open is not shown on another Report's sheet). One still in flight is kept.
  useEffect(() => {
    const dismiss = (): void => {
      const r = useBuildRun.getState();
      useBuildRun.setState({ ...(r.made !== null && !r.made.busy ? { made: null } : {}), failNote: null });
    };
    dismiss();
    return dismiss;
  }, []);
  const onMade = async ({ slug }: { slug: string }): Promise<void> => {
    useBuildRun.setState({ creating: false });
    if (useBuildRun.getState().fullAtSend) { openApp(slug); return; }
    await pin(slug, nameFrom(slug));
  };
  // Focus stays in the dialog, on a control it can Tab from (xreview r1, r2): while crew makes the app the composer stays
  // (blocked, with its words and project kept), so nothing moves; when it gives way to the verdict, the first action;
  // while the app is put on Report, Close.
  const status = useRef<HTMLDivElement | null>(null);
  const phase = made === null ? 'compose' : made.busy ? 'pinning' : 'made';
  useEffect(() => {
    if (phase === 'compose') return;
    const target = phase === 'made' ? status.current?.querySelector<HTMLButtonElement>('button') : box.current?.querySelector<HTMLButtonElement>('[data-testid="report-build-close"]');
    target?.focus({ preventScroll: true });
  }, [phase]);
  // crew made no app: back to the composer, its words kept, with the focus in it (a Send that was clicked was disabled
  // while it waited, which drops the focus to the page).
  // While crew makes it, too (xreview r3): Send is disabled then, which also drops the focus to the page.
  const wasCreating = useRef(run.creating);
  useEffect(() => {
    const box_ = box.current;
    const input = box_?.querySelector<HTMLTextAreaElement>('[data-testid="apps-new-composer-input"]') ?? null;
    if (run.creating && !wasCreating.current && (box_ === null || !box_.contains(document.activeElement) || (document.activeElement as HTMLButtonElement | null)?.disabled === true)) input?.focus();
    if (wasCreating.current && !run.creating && useBuildRun.getState().made === null) input?.focus();
    wasCreating.current = run.creating;
  }, [run.creating]);
  const fullNames = shown.map((s) => shownName(s, apps));
  const madeWhy = made === null || made.busy ? null
    : made.verdict.kind === 'full' ? verdictWords(made.verdict, made.name, (s) => s.map((x) => shownName(x, apps)))
      : made.verdict.kind === 'failed' || made.verdict.kind === 'dropped' || made.verdict.kind === 'refused' ? made.verdict.reason : null;

  return (
    <div className="wk-rep-build-scrim" data-testid="report-build-scrim" data-page-chat-skip="" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} className="wk-rep-build" role="dialog" aria-modal="true" aria-labelledby="wk-rep-build-title" data-testid="report-build-sheet">
        <header className="wk-rep-build-head">
          <h2 id="wk-rep-build-title" className="wk-rep-build-title">Build a dashboard</h2>
          <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm wk-rep-build-x" data-testid="report-build-close" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <p className="wk-rep-build-sub">Say what it should show: your data sources, or what this project knows (its documents, memories, steering rules and data shapes). An agent builds it, another reviews it, and it’s pinned here.</p>
        {made !== null ? (
          <div ref={status} className="wk-rep-build-made" data-testid="report-build-made" data-verdict={made.busy ? 'pending' : made.verdict.kind}>
            {made.busy ? <p className="wk-rep-build-line" role="status">Made {made.name}. Putting it on Report…</p> : (
              <>
                <p className="wk-rep-build-line" data-tone="warn" role="status" data-testid="report-build-made-why">Made {made.name}, but it isn’t on Report: {madeWhy}</p>
                <div className="wk-rep-build-actions">
                  {(made.verdict.kind === 'failed' || made.verdict.kind === 'dropped') && (
                    <button type="button" className="wk-btn wk-btn--primary" data-testid="report-build-retry" onClick={() => void pin(made.slug, made.name)}>Try again</button>
                  )}
                  <button type="button" className="wk-btn wk-btn--secondary" data-testid="report-build-open" onClick={() => open(made.slug)}>Open it</button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="wk-rep-build-for" data-testid="report-build-for">
              <span>Suggested for</span> <span className="wk-rep-chip" data-testid="report-build-period">{period}</span>
              {sources.state === 'reading' && <span data-testid="report-build-sources-reading">Reading the sources {chosenName} can use…</span>}
              {sources.state === 'failed' && <span data-testid="report-build-sources-failed">The sources {chosenName} can use couldn’t be read: {sources.why}</span>}
              {sources.state === 'ok' && sources.summary !== null && names.length === 0 && <span data-testid="report-build-sources-none">No data source to suggest for {chosenName} yet.</span>}
              {sources.state === 'ok' && names.length > 0 && (
                <span className="wk-rep-build-sources">from the sources {chosenName} can use: {names.map((n) => <span key={n} className="wk-rep-chip" data-testid="report-build-source">{n}</span>)}</span>
              )}
            </div>
            <NewAppChat navigate={navigate} framed={framed} composerKey="report:new" heading={false} lock={lock} eligibleOnly={lock === null}
              suggestions={seeds} onProject={onProject} onMade={onMade}
              blocked={run.creating ? 'Making the app and sending your message…' : null}
              onSend={() => useBuildRun.setState({ creating: true, failNote: null, origin, fullAtSend: useReportShown.getState().shown.length >= REPORT_MAX })}
              onFailed={(note) => useBuildRun.setState({ creating: false, failNote: note })}
              placeholder="Describe the dashboard you want…" ariaLabel="Describe the dashboard you want" testId="report-build-chat"
              before={full ? <p className="wk-rep-build-line" data-tone="warn" data-testid="report-build-full">Report shows {REPORT_MAX} dashboards; turn one off first: {fullNames.join(', ')}. This one won’t show here.</p> : null} />
            <p className="wk-rep-build-foot" data-testid="report-build-foot">
              {full ? 'Its Show on Report switch can be turned on later, from its Properties.'
                : <>It shows on this Report when it’s made: <b>Show on Report</b> starts on ({shown.length} of {REPORT_MAX} shown).</>}
              {' '}It reads your data sources or what this project knows; Report’s own numbers, such as spend and steps, can’t go on a dashboard yet.
            </p>
            {run.failNote !== null && <p className="wk-rep-build-line" data-tone="warn" data-testid="report-build-failnote">{run.failNote}</p>}
            {load === 'failed' && <p className="wk-rep-build-line" data-tone="warn">{UNREAD_WHY}: it is tried again when the app is made.</p>}
          </>
        )}
      </div>
    </div>
  );
}
