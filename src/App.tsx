import { useCallback, useEffect, useState } from 'react';
import { CenterDashboard } from './components/CenterDashboard.js';
import { ChatsPage } from './components/ChatsPage.js';
import { CoverageView } from './components/CoverageView.js';
import { DomainModelBrowser } from './components/DomainModelBrowser.js';
import { GateNotifications } from './components/GateNotifications.js';
import { HomeBoard } from './components/HomeBoard.js';
import { LeftSidebar } from './components/LeftSidebar.js';
import { DocumentCanvas } from './components/DocumentCanvas.js';
import { DocumentThread } from './components/DocumentThread.js';
import { VideoStoryboard } from './components/VideoStoryboard.js';
import { PolicyManager } from './components/PolicyManager.js';
import { ProjectDashboard } from './components/ProjectDashboard.js';
import { ProjectShell } from './components/ProjectShell.js';
import { ProjectDetailPage } from './components/ProjectDetailPage.js';
import { ProjectsPage } from './components/ProjectsPage.js';
import { RepositoriesPanel } from './components/RepositoriesPanel.js';
import { RepoDetailPage } from './components/RepoDetailPage.js';
import { RepoGraphModal } from './components/RepoGraphModal.js';
import { RightPanel } from './components/RightPanel.js';
import { RuleManager } from './components/RuleManager.js';
import { ChatPanel } from './components/ChatPanel.js';
import { GroupChat } from './components/GroupChat.js';
import { WorkflowViewer } from './components/WorkflowViewer.js';
import { WorkPage } from './components/WorkPage.js';
import { SystemSettings } from './components/SystemSettings.js';
import { ThemePage } from './components/ThemePage.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useLegacyRedirect } from './hooks/useLegacyRedirect.js';
import { modePath, routedVersion, useRoute, type Mode } from './hooks/useRoute.js';
import { useRuns } from './hooks/useRuns.js';
import { useGateStore } from './store/gates.js';
import { useElicitationStore } from './store/elicitations.js';
import { useNotificationStore } from './store/notifications.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import { useDocThreadStore } from './store/docThread.js';
import type { CoreEvent, RepoEntry } from './api/types.js';
import { api } from './api/client.js';
import { useAppearanceStore } from './theming/appearance.js';

/** Frames that change run-list / unit state → trigger a `GET /runs` reconcile. */
const LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  'sessionStarted',
  'unitPlanned',
  'unitDistributed',
  'unitExecuting',
  'gateDecided',
  'unitDone',
  'unitDenied',
  'awaitingHuman',
  'resumed',
  'runCancelled',
  'sessionFailed',
  'sessionCompleted',
]);

/**
 * Ctrl+K keyboard shortcut — kill the selected run when it is not in a terminal state.
 * Wired here (global handler) so it works regardless of which panel has focus.
 */
function useKillShortcut(
  runId: string | null,
  runs: { session: { id: string; status: string } }[],
  onKill: (id: string) => Promise<void>,
): void {
  useEffect(() => {
    if (!runId) return;
    function handler(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k' && runId) {
        const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
        const editable = (e.target as HTMLElement | null)?.isContentEditable ?? false;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;
        const run = runs.find((r) => r.session.id === runId);
        if (!run) return;
        const terminal = ['completed', 'cancelled', 'failed'].includes(run.session.status);
        if (!terminal) {
          e.preventDefault();
          void onKill(runId);
        }
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [runId, runs, onKill]);
}

export function App(): React.ReactElement {
  const { panel, runId, repoId, projectId, mode, artifactId, showLaunch, showRegisterRepo, chatMode, navigate, search } = useRoute();
  const { runs, refresh } = useRuns();
  const ingestGate = useGateStore((s) => s.ingest);
  const ingestElicitation = useElicitationStore((s) => s.ingest);
  const ingestNotif = useNotificationStore((s) => s.ingest);
  const ingestRuntime = useRuntimeStore((s) => s.ingest);
  const ingestRunEvent = useRunEventStore((s) => s.ingest);
  const ingestDocThread = useDocThreadStore((s) => s.ingest);

  // Dashboard gate callbacks — the CenterDashboard handles the API call + store
  // clearing itself; these callbacks exist for any post-confirmation side-effects
  // the parent needs (currently: refresh the run list to pick up status changes).
  const onDashboardApproveGate = useCallback((): void => {
    refresh();
  }, [refresh]);

  const onDashboardRejectGate = useCallback((): void => {
    refresh();
  }, [refresh]);

  const handleEvent = useCallback(
    (event: CoreEvent) => {
      ingestGate(event);
      ingestElicitation(event);
      ingestNotif(event);
      ingestRuntime(event);
      ingestRunEvent(event);
      // Relayed interactive frames feed BOTH altitudes off the one subscription (§3.4):
      // the runtime store's board headline above, the doc transcript here.
      ingestDocThread(event);
      if (LIFECYCLE_EVENTS.has(event.type)) refresh();
    },
    [ingestGate, ingestElicitation, ingestNotif, ingestRuntime, ingestRunEvent, ingestDocThread, refresh],
  );

  useEventStream(handleEvent);

  // Per-install appearance (DES-VISION-001 §3.3): one startup read of crew's
  // settings store; `studio.appearance` lands as inline custom-property
  // overrides on <html> — the cascade seam tokens.css declares for this.
  useEffect(() => {
    void useAppearanceStore.getState().load();
  }, []);

  // Pre-merge bookmarks (`/runs/:id`, `/projects/:id`) redirect into the shell (§1.5).
  useLegacyRedirect({ panel, runId, projectId, mode, showLaunch }, navigate);

  // FINDING-013: /ws has no late-join replay, so a page reloaded against a run shows an empty Burn
  // panel even though usage was durably recorded. When the selected run has no frames yet (a reload
  // with no live socket history), backfill from the persisted event trail. Guarded on emptiness (and
  // again inside the store) so a live run's streamed frames are never double-counted; a 503 (engine
  // with no event-log binding) or a run with no history simply leaves the panels as they are.
  //
  // The same replay gap hid the run thread's live narration: the runtime store's `outputs` buffers
  // were fed ONLY by live `unitOutputDelta`/`cliOutputDelta` frames (the structured-event hydrate
  // above deliberately drops them), so opening an already-executing run showed a bare "Working…"
  // even though the streamed text was durably recorded. The same fetch now also seeds those
  // buffers, per-key guarded inside the store so live frames are never double-counted.
  useEffect(() => {
    if (!runId) return;
    const hasFrames = (useRunEventStore.getState().byRun[runId] ?? []).length > 0;
    const hasOutputs = Object.keys(useRuntimeStore.getState().outputs).some((k) =>
      k.startsWith(`${runId}:u`),
    );
    if (hasFrames && hasOutputs) return;
    let cancelled = false;
    api
      .getRunEvents(runId)
      .then(({ events }) => {
        if (cancelled) return;
        useRunEventStore.getState().hydrate(runId, events);
        useRuntimeStore.getState().hydrateOutputs(runId, events);
      })
      .catch(() => {
        /* no event-log binding, or the run has no persisted history — no backfill */
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  // Inside the project shell, selecting a run stays in the shell (Chat keeps Chat, every
  // other mode opens Build) instead of bouncing out to /runs/:id and redirecting back.
  const runPath = useCallback(
    (id: string) =>
      projectId && mode
        ? modePath(projectId, mode === 'chat' ? 'chat' : 'build', id)
        : `/runs/${encodeURIComponent(id)}`,
    [projectId, mode],
  );

  const selectRun = useCallback((id: string) => navigate(runPath(id)), [navigate, runPath]);

  const onLaunched = useCallback(
    (id: string) => {
      refresh();
      navigate(runPath(id));
    },
    [navigate, refresh, runPath],
  );

  // Outside the project shell, "back" belongs to the list the run was opened from —
  // `/runs`, not the board (§1.5): `/` is now a different surface, not this one's parent.
  const onNavigateBack = useCallback(
    () => navigate(projectId && mode ? modePath(projectId, mode) : '/runs'),
    [navigate, projectId, mode],
  );

  const onKill = useCallback(
    async (id: string) => {
      try {
        await api.cancelRun(id);
        refresh();
      } catch {
        // surface kill errors only in RightPanel; fail silently from the shortcut
      }
    },
    [refresh],
  );

  useKillShortcut(runId, runs, onKill);

  const selected = runs.find((v) => v.session.id === runId) ?? null;

  // ── Repo graph modal — opened from RepoDetailPage via onOpenGraph ───────────
  const [graphModalRepo, setGraphModalRepo] = useState<RepoEntry | null>(null);
  const [graphModalFocus, setGraphModalFocus] = useState<string | null>(null);

  const openGraphModal = useCallback(
    (focus?: string) => {
      if (!repoId) return;
      setGraphModalFocus(focus ?? null);
      void api.listRepos().then(({ repos }) => {
        const r = repos.find((x) => x.id === repoId);
        if (r) setGraphModalRepo(r);
      });
    },
    [repoId],
  );

  // The three center surfaces, rendered by the legacy routes AND by the project shell.
  // Slice 4 WIRES them; sharing the expression is what keeps "the same surface" literal.
  const dashboardSurface = (): React.ReactElement => (
    <div className="flex-1 overflow-y-auto">
      <CenterDashboard
        runs={runs}
        onSelectRun={selectRun}
        onApproveGate={onDashboardApproveGate}
        onRejectGate={onDashboardRejectGate}
        navigate={navigate}
        projectId={projectId}
      />
    </div>
  );

  // In the project shell the new chat is FILED into the project at open time
  // (DES-FEEDBACK-001 §5.1 — `projectId` on the POST body, never a silent unfiled
  // thread); outside it, GroupChat renders its own ProjectSwitcher (§5.2).
  const groupChatSurface = (repo: string | null, pid: string | null = null): React.ReactElement => (
    <div className="flex-1 overflow-hidden">
      <GroupChat repoId={repo} onBack={onNavigateBack} projectId={pid} navigate={navigate} />
    </div>
  );

  // §4.3 pre-bind: `/p/:projectId/build/new` is the launch form LOCKED to the
  // project; the flat `/runs/new` stays unbound (Unfiled default, §5.1).
  const launchProjectId = projectId !== null && mode === 'build' && showLaunch ? projectId : null;

  const runSurface = (): React.ReactElement => (
    <div className="flex-1 overflow-hidden">
      <ChatPanel
        view={selected}
        chatMode={chatMode}
        onLaunched={onLaunched}
        onNavigateBack={onNavigateBack}
        onRefresh={refresh}
        onKill={onKill}
        navigate={navigate}
        launchProjectId={launchProjectId}
      />
    </div>
  );

  /**
   * What a mode renders inside the shell (DES-MERGE-001 §6.2, slice 4). Document is the
   * interactive canvas (§6.3, slice 8); Video still states what is coming and the action
   * that enables it; Chat and Build reuse the existing surfaces above.
   *
   * Build with nothing open is the existing run home, UNSCOPED: scoping a project's runs
   * is the board's data plumbing (slices 5-6) and needs launch to file the run it creates,
   * so filtering here first would hide a run the user had just launched.
   */
  function renderModeSurface(m: Mode, pid: string): React.ReactElement {
    // The document's VERSION rides in the query (`?v=N`, slice 9) — the artifact is the
    // doc, the version is a lens on it — so the strip's selection is a real navigation.
    if (m === 'document') {
      // Canvas and thread stay VISUAL siblings — the thread is fixed-width and never
      // force-opened over the canvas (§1.2, §2.5) — but the thread passes through
      // `DocumentCanvas` as its children so the version strip renders BELOW BOTH: the
      // spine spanning canvas and thread, DES-UXFIX-001 §2.6 rule 2 (the F9 fix).
      return (
        <DocumentCanvas
          projectId={pid}
          docId={artifactId}
          version={routedVersion(search)}
          navigate={navigate}
        >
          <DocumentThread
            projectId={pid}
            docId={artifactId}
            selectedVersion={routedVersion(search)}
            navigate={navigate}
          />
        </DocumentCanvas>
      );
    }
    // Video is the same canvas-first shape as Document (DES-FEEDBACK-001 §7.4): the
    // storyboard HTML frames in the canvas, and the SAME thread passes through as the
    // drawer's children — a demo is a document whose manifest says `kind: "demo"`, so
    // its conversation is the project's one conversation (§1.3 rule 1).
    if (m === 'video') {
      return (
        <VideoStoryboard
          projectId={pid}
          demoId={artifactId}
          version={routedVersion(search)}
          navigate={navigate}
        >
          <DocumentThread
            projectId={pid}
            docId={artifactId}
            selectedVersion={null}
            navigate={navigate}
            mode="video"
          />
        </VideoStoryboard>
      );
    }
    if (m === 'chat' && !artifactId) return groupChatSurface(null, pid);
    // `showLaunch` here is `/p/:pid/build/new` — the §4.3 pre-bound launch form.
    return artifactId || showLaunch ? runSurface() : dashboardSurface();
  }

  // Center panel content based on route
  function renderCenter(): React.ReactElement {
    // The project shell owns every `/p/*` route and is checked FIRST — the panel parse
    // below is untouched and still owns the flat cross-project lists and side panels.
    if (projectId !== null && mode !== null) {
      return (
        <ProjectShell projectId={projectId} mode={mode} artifactId={artifactId} navigate={navigate}>
          {renderModeSurface(mode, projectId)}
        </ProjectShell>
      );
    }
    // `/p/:projectId` with NO mode segment is the PROJECT DASHBOARD (DES-FEEDBACK-001
    // §4.1, slice D) — context before actions, replacing the last-used-mode redirect.
    // Not a fifth mode: no shell, no switcher tab; the mode verbs live in its header.
    // (`panel === 'project-detail'` is the legacy `/projects/:id` page, which keeps
    // its own branch below while `useLegacyRedirect` replaces it with this route.)
    if (projectId !== null && panel !== 'project-detail') {
      return (
        <div className="flex-1 overflow-y-auto">
          <ProjectDashboard projectId={projectId} runs={runs} navigate={navigate} />
        </div>
      );
    }
    // `/` is the orchestrator board (§1.4, slice 5); the flat run list it replaced is
    // still at `/runs`, which the `panel === 'runs'` fallback below keeps rendering.
    if (panel === 'home') {
      return <HomeBoard runs={runs} navigate={navigate} />;
    }
    if (panel === 'coverage') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <CoverageView />
        </div>
      );
    }
    if (panel === 'workflows') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <WorkflowViewer />
        </div>
      );
    }
    if (panel === 'domain') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <DomainModelBrowser />
        </div>
      );
    }
    if (panel === 'policies') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <PolicyManager />
        </div>
      );
    }
    if (panel === 'rules') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <RuleManager />
        </div>
      );
    }
    if (panel === 'repos') {
      return (
        <div className="flex-1 overflow-hidden">
          <RepositoriesPanel onSelectRun={selectRun} autoShowRegister={showRegisterRepo} navigate={navigate} />
        </div>
      );
    }
    if (panel === 'repo-detail' && repoId) {
      return (
        <div className="flex-1 overflow-y-auto">
          <RepoDetailPage
            repoId={repoId}
            onSelectRun={selectRun}
            navigate={navigate}
            onOpenGraph={openGraphModal}
          />
        </div>
      );
    }
    if (panel === 'chats') {
      return (
        <div className="flex-1 overflow-y-auto">
          <ChatsPage runs={runs} onSelect={selectRun} navigate={navigate} />
        </div>
      );
    }
    if (panel === 'work') {
      return (
        <div className="flex-1 overflow-y-auto">
          <WorkPage runs={runs} selectedRunId={runId} onSelect={selectRun} navigate={navigate} />
        </div>
      );
    }
    if (panel === 'projects') {
      return (
        <div className="flex-1 overflow-y-auto">
          <ProjectsPage navigate={navigate} />
        </div>
      );
    }
    // `/projects/:id` redirects into the shell (§1.5); this renders only for the tick
    // before the redirect lands, and is the fallback if the redirect never does.
    if (panel === 'project-detail' && projectId) {
      return (
        <div className="flex-1 overflow-y-auto">
          <ProjectDetailPage projectId={projectId} navigate={navigate} />
        </div>
      );
    }
    if (panel === 'system') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <SystemSettings navigate={navigate} />
        </div>
      );
    }
    if (panel === 'theme') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <ThemePage />
        </div>
      );
    }
    // Home dashboard: no run selected and not launching — three-panel home view + manager controls
    if (panel === 'runs' && !runId && !selected && !showLaunch) {
      return dashboardSurface();
    }
    // NEW CHAT: the group-chat surface (warm seats + fan-out), not a run (crew#165).
    if (chatMode && selected === null) {
      return groupChatSurface(repoId);
    }
    // Run selected or launch form
    return runSurface();
  }

  return (
    <div className="flex h-screen overflow-hidden bg-surface-base">
      {/* DES-FEEDBACK-001 §7.3: Document and Video are canvas-first — the rail
          auto-collapses to icons on entry and restores on exit. */}
      <LeftSidebar
        runs={runs}
        navigate={navigate}
        runPath={runPath}
        immersive={projectId !== null && (mode === 'document' || mode === 'video')}
      />

      <div className="flex flex-1 overflow-hidden">
        {renderCenter()}
      </div>

      {/* Right panel only when a run is selected */}
      {selected !== null && (
        <RightPanel view={selected} />
      )}

      {/* Gate toasts — renders above everything; scoped to the current run. NOT on the
          orchestrator board: there every waiting gate is already an answerable chip on
          its project's card, sorted to the front (§1.4, slice 7), and the unscoped stack
          would both duplicate those chips and physically cover the cards holding them. */}
      {panel !== 'home' && <GateNotifications onSelect={selectRun} runId={runId} />}

      {/* Repo graph modal — opened from RepoDetailPage */}
      {graphModalRepo !== null && (
        <RepoGraphModal
          repo={graphModalRepo}
          initialFocus={graphModalFocus}
          onClose={() => { setGraphModalRepo(null); setGraphModalFocus(null); }}
          onSelectRun={selectRun}
        />
      )}
    </div>
  );
}
