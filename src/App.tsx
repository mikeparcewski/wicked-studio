import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CenterDashboard } from './components/CenterDashboard.js';
import { CommandPalette, paletteShortcutEntries } from './components/CommandPalette.js';
import { ChatsPage } from './components/ChatsPage.js';
import { CoverageView } from './components/CoverageView.js';
import { DomainModelBrowser } from './components/DomainModelBrowser.js';
import { GateNotifications } from './components/GateNotifications.js';
import { HomeBoard } from './components/HomeBoard.js';
import { MakeDashboard } from './components/MakeDashboard.js';
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
import { RunsBottomPanel, RUNS_BAR_PX } from './components/RunsBottomPanel.js';
import { ChatPanel } from './components/ChatPanel.js';
import { GroupChat } from './components/GroupChat.js';
import { WorkflowViewer } from './components/WorkflowViewer.js';
import { WorkPage } from './components/WorkPage.js';
import { ShortcutOverlay } from './components/ShortcutOverlay.js';
import { SystemSettings } from './components/SystemSettings.js';
import { ThemePage } from './components/ThemePage.js';
import { ambientProjectId } from './hooks/ambientProject.js';
import { useEventStream } from './hooks/useEventStream.js';
import { setShortcutsPaletteOpen, useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useLegacyRedirect } from './hooks/useLegacyRedirect.js';
import { modePath, routedVersion, useRoute, type Mode } from './hooks/useRoute.js';
import { useRuns } from './hooks/useRuns.js';
import { useAnnotationStore } from './store/annotations.js';
import { useGateStore } from './store/gates.js';
import { useElicitationStore } from './store/elicitations.js';
import { useLiveChatsStore } from './store/liveChats.js';
import { useNotificationStore } from './store/notifications.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import { useDocThreadStore } from './store/docThread.js';
import type { CoreEvent, RepoEntry } from './api/types.js';
import { api } from './api/client.js';
import { useAppearanceStore } from './theming/appearance.js';
import { useNotifPrefsStore } from './store/notifPrefs.js';
import { notifyGateIfUnfocused } from './board/desktopNotify.js';

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

/** Terminal run states — a run here can no longer be cancelled. */
const TERMINAL_STATES = ['completed', 'cancelled', 'failed'];

export function App(): React.ReactElement {
  const { panel, runId, repoId, projectId, mode, artifactId, showLaunch, showRegisterRepo, chatMode, navigate, search, pathname } = useRoute();
  const { runs, refresh, loaded: runsLoaded } = useRuns();
  const ingestGate = useGateStore((s) => s.ingest);
  const ingestAnnotation = useAnnotationStore((s) => s.ingest);
  const ingestElicitation = useElicitationStore((s) => s.ingest);
  const ingestNotif = useNotificationStore((s) => s.ingest);
  const ingestRuntime = useRuntimeStore((s) => s.ingest);
  const ingestRunEvent = useRunEventStore((s) => s.ingest);
  const ingestDocThread = useDocThreadStore((s) => s.ingest);
  const ingestLiveChat = useLiveChatsStore((s) => s.ingest);

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
      // Slice BD: terminal frames retire a run's pre-gate annotation draft.
      ingestAnnotation(event);
      ingestElicitation(event);
      ingestNotif(event);
      ingestRuntime(event);
      ingestRunEvent(event);
      // Relayed interactive frames feed BOTH altitudes off the one subscription (§3.4):
      // the runtime store's board headline above, the doc transcript here.
      ingestDocThread(event);
      // J4 round 2: chat frames announce/retire live sessions for the rail's
      // Chat accordion — evidence this subscription already carries, no fetch.
      ingestLiveChat(event);
      // Slice L (DES-FEEDBACK-002 §8.2): the desktop layer folds off the SAME
      // subscription — hidden-tab-only, opt-in, permission-gated, never prompts.
      notifyGateIfUnfocused(event);
      if (LIFECYCLE_EVENTS.has(event.type)) refresh();
    },
    [ingestGate, ingestAnnotation, ingestElicitation, ingestNotif, ingestRuntime, ingestRunEvent, ingestDocThread, ingestLiveChat, refresh],
  );

  useEventStream(handleEvent);

  // Per-install appearance (DES-VISION-001 §3.3): one startup read of crew's
  // settings store; `studio.appearance` lands as inline custom-property
  // overrides on <html> — the cascade seam tokens.css declares for this.
  useEffect(() => {
    void useAppearanceStore.getState().load();
    // Slice L: `studio.notifications` rides the same settings store — read
    // once at startup; the defaults (Off) stand if the surface is absent.
    // Never touches the Notification API (EC25: no prompt on load).
    void useNotifPrefsStore.getState().load();
  }, []);

  // Pre-merge bookmarks (`/runs/:id`, `/projects/:id`) redirect into the shell (§1.5).
  useLegacyRedirect({ panel, runId, projectId, mode, showLaunch, chatMode }, navigate);

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
  // `/work`, the ONE canonical runs surface (DES-UX-001 §7.4, slice Y — the bare
  // `/runs` listing retired into a redirect): `/` is a different surface, not this
  // one's parent.
  const onNavigateBack = useCallback(
    () => navigate(projectId && mode ? modePath(projectId, mode) : '/work'),
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

  const selected = runs.find((v) => v.session.id === runId) ?? null;

  // ── DES-FEEDBACK-002 §1.2 (slice G): shortcut registry + command palette ────
  // Cmd/Ctrl+K and Ctrl/Cmd+P open the palette (the unconditional, safe action
  // gets the prime chord); kill-run relocates to Ctrl/Cmd+Shift+K with its
  // guards and silent-fail contract intact, and also rides the palette as the
  // `> Cancel run` verb. One listener, one guard — `useGlobalShortcuts`.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // §5.2 (slice J): Cmd+Shift+F opens the palette in SEARCH mode — the seed is
  // the pre-typed `?` prefix; the plain toggles seed nothing.
  const [paletteSeed, setPaletteSeed] = useState('');
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
    setShortcutsPaletteOpen(paletteOpen);
  }, [paletteOpen]);

  const shortcutEntries = useMemo(
    () =>
      paletteShortcutEntries({
        isOpen: () => paletteOpenRef.current,
        setOpen: (next: boolean) => {
          setPaletteSeed('');
          setPaletteOpen(next);
        },
        openSearch: () => {
          setPaletteSeed('?');
          setPaletteOpen(true);
        },
        killEligible: () => {
          if (!runId) return false;
          const run = runs.find((r) => r.session.id === runId);
          return run !== undefined && !TERMINAL_STATES.includes(run.session.status);
        },
        kill: () => {
          if (runId) void onKill(runId);
        },
      }),
    [runId, runs, onKill],
  );
  useGlobalShortcuts(shortcutEntries);

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
  // `routedChatId`/`reflectUrl` (J4/C6): on the FLAT chat routes the session's
  // id lives in the URL — `/chat/:id` the moment the session exists — so an
  // opened chat is findable again after navigating away. The project shell's
  // chat keeps its own `/p/:pid/chat` address and does not reflect.
  const groupChatSurface = (
    repo: string | null,
    pid: string | null = null,
    routedChatId: string | null = null,
    reflectUrl = false,
  ): React.ReactElement => (
    <div className="flex-1 overflow-hidden">
      <GroupChat
        repoId={repo}
        onBack={onNavigateBack}
        projectId={pid}
        navigate={navigate}
        routedChatId={routedChatId}
        reflectUrl={reflectUrl}
      />
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
        // Slice Z (§7.6): the route names a run the index has not resolved —
        // a just-launched navigation or a mid-run reload racing GET /runs.
        // ChatPanel holds the honest pending state, never the composer.
        pendingRunId={selected === null ? runId : null}
        runsLoaded={runsLoaded}
      />
    </div>
  );

  /**
   * What a mode renders inside the shell (DES-MERGE-001 §6.2, slice 4). Document is the
   * interactive canvas (§6.3, slice 8); Video still states what is coming and the action
   * that enables it; Chat and Build reuse the existing surfaces above.
   *
   * Build with nothing open is the run home SCOPED to the project (DES-UX-001 §2.3
   * rule 2, slice S — superseding the old "unscoped until launch files" caveat: launch
   * DOES file the run now, and the DTO echoes `project_id` back, so a just-launched run
   * appears in its project's list within one live-update cycle instead of vanishing).
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
          <RepositoriesPanel
            onSelectRun={selectRun}
            autoShowRegister={showRegisterRepo}
            navigate={navigate}
            // Slice S (DES-UX-001 §2.3 rule 1): `/repos/new?project=<id>` — the
            // ambient-project carry from an entry point inside a project context.
            // The ONE shared derivation; the panel itself never re-parses the URL.
            ambientProject={ambientProjectId(pathname, search)}
          />
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
          {/* `search` carries §7.4's context-sensitive entry (slice Y): arriving
              from a failure context (`?filter=failed`) lands with that tab active. */}
          <WorkPage runs={runs} selectedRunId={runId} onSelect={selectRun} navigate={navigate} search={search} />
        </div>
      );
    }
    if (panel === 'projects') {
      return (
        <div className="flex-1 overflow-y-auto">
          <ProjectsPage runs={runs} navigate={navigate} />
        </div>
      );
    }
    // `/make` — the Make path's combined list + reporting dashboard
    // (DES-FEEDBACK-003 §4.2, slice O; the slice-M placeholder retired).
    if (panel === 'make') {
      return (
        <div className="flex-1 overflow-y-auto" data-testid="make-dashboard">
          <MakeDashboard runs={runs} navigate={navigate} runPath={runPath} />
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
    // CHAT: the group-chat surface (warm seats + fan-out), not a run (crew#165).
    // Checked BEFORE the home-dashboard fallback: `/chat/:id` (J4/C6) carries no
    // runId/showLaunch and must land here, not on the dashboard. `artifactId`
    // is the routed session id; the flat routes reflect the live id in the URL.
    if (chatMode && selected === null) {
      return groupChatSurface(repoId, null, artifactId, true);
    }
    // Home dashboard: no run selected and not launching — three-panel home view + manager controls
    if (panel === 'runs' && !runId && !selected && !showLaunch) {
      return dashboardSurface();
    }
    // Run selected or launch form
    return runSurface();
  }

  // DES-FEEDBACK-001 §7.3 / DES-FEEDBACK-003 §5.5: Document and Video are
  // canvas-first — the rail auto-collapses on entry, and the runs bottom
  // sheet auto-collapses on the same transition (EC27).
  const immersive = projectId !== null && (mode === 'document' || mode === 'video');

  return (
    // §5.2: the root reserves the bar's 28px as padding — the collapsed bar is
    // a ROW, not an overlay, so every surface (board, dashboards, canvas — and
    // with it the version strip's proximity-sensor band, which ends at the
    // canvas edge) ends ABOVE the bar. Nothing is ever covered while collapsed.
    <div className="flex h-screen overflow-hidden bg-surface-base" style={{ paddingBottom: RUNS_BAR_PX }}>
      <LeftSidebar
        runs={runs}
        navigate={navigate}
        pathname={pathname}
        runPath={runPath}
        immersive={immersive}
      />

      <div className="flex flex-1 overflow-hidden">
        {renderCenter()}
      </div>

      {/* Right panel only when a run is selected */}
      {selected !== null && (
        <RightPanel view={selected} runs={runs} onSelectRun={selectRun} />
      )}

      {/* The universal command palette (DES-FEEDBACK-002 §1, slice G) — corpus
          from already-loaded stores + the runs prop; repos cached on first open. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => { setPaletteOpen(false); setPaletteSeed(''); }}
        seed={paletteSeed}
        runs={runs}
        navigate={navigate}
        runPath={runPath}
        projectId={projectId}
        selectedRun={selected}
        onKill={(id) => void onKill(id)}
      />

      {/* The runs bottom panel (DES-FEEDBACK-003 §5, slice N): a fourth reader
          of the SAME `useRuns()` array plus the client-held stores — zero new
          requests, zero new sockets. Fixed at the viewport bottom, everywhere.
          Inside a project route its counters scope to THAT project's runs
          (DES-UX-001 §2.3 rule 2, slice S — `data-scope="project"`). */}
      <RunsBottomPanel
        runs={runs}
        runPath={runPath}
        navigate={navigate}
        immersive={immersive}
        scopeProjectId={projectId}
      />

      {/* Gate toasts — renders above everything; scoped to the current run. NOT on the
          orchestrator board: there every waiting gate is already an answerable chip on
          its project's card, sorted to the front (§1.4, slice 7), and the unscoped stack
          would both duplicate those chips and physically cover the cards holding them.
          Slice AA (§7.1): inside a project shell only THAT project's gates paint cards —
          a foreign gate announces in the runs bar + bell instead (B4). */}
      {panel !== 'home' && (
        <GateNotifications onSelect={selectRun} runId={runId} projectId={projectId} runs={runs} />
      )}

      {/* The '?' shortcut overlay (DES-UX-001 §7.7, EC42) — every route: this
          root renders on all of them, and the overlay's corpus is the registry
          itself, so each surface documents exactly the keys it registered. */}
      <ShortcutOverlay />

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
