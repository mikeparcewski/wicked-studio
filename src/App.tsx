import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorHostPage } from './components/editors/EditorHostPage.js';
import { CenterDashboard } from './components/CenterDashboard.js';
import { AskDock } from './components/AskDock.js';
import { useAskThreadStore } from './store/askThread.js';
import { AskLauncher } from './components/AskLauncher.js';
import { CommandPalette, paletteShortcutEntries } from './components/CommandPalette.js';
import { GateNotifications } from './components/GateNotifications.js';
import { ProjectCampaignsView } from './components/ProjectCampaignsView.js';
import { DocumentCanvas } from './components/DocumentCanvas.js';
import { DocumentThread } from './components/DocumentThread.js';
import { DemoMode } from './components/DemoMode.js';
import { NotFoundPage } from './components/NotFoundPage.js';
import { SkipLink } from './components/SkipLink.js';
import { ProjectShell } from './components/ProjectShell.js';
import { ProjectDetailPage } from './components/ProjectDetailPage.js';
import { RepositoriesPanel } from './components/RepositoriesPanel.js';
import { RepoDetailPage } from './components/RepoDetailPage.js';
import { RepoGraphModal } from './components/RepoGraphModal.js';
import { RightPanel } from './components/RightPanel.js';
import { RunRawView } from './components/RunRawView.js';
import { SkillsPage } from './components/SkillsPage.js';
import { McpToolsPage } from './components/McpToolsPage.js';
import { SteeringPage } from './components/SteeringPage.js';
import { MemoriesPanel } from './components/MemoriesPanel.js';
import { GovernanceDashboard } from './components/GovernanceDashboard.js';
import { TestingPage } from './components/TestingPage.js';
import { LaunchPanel } from './components/LaunchPanel.js';
import { GroupChat } from './components/GroupChat.js';
import { WorkflowViewer } from './components/WorkflowViewer.js';
import { ShortcutOverlay } from './components/ShortcutOverlay.js';
import { PeekCard } from './components/PeekCard.js';
import { UndoToasts } from './components/UndoToasts.js';
import { ConnectionStatus } from './components/ConnectionStatus.js';
import { SystemSettings } from './components/SystemSettings.js';
import { ThemePage } from './components/ThemePage.js';
import { Desk } from './components/desk/Desk.js';
import { SessionRail } from './components/desk/SessionRail.js';
import { SessionPage } from './components/session/SessionView.js';
import type { ComposerSend } from './components/session/Composer.js';
import { ObjectSheet } from './components/sheets/ObjectSheet.js';
import { AltPeek } from './components/sheets/AltPeek.js';
import { objectCommands, type ObjectCommands } from './components/sheets/objectCommands.js';
import { cmdkObject, trackPointedObject } from './store/sheets.js';
import { useNeedsClock, useNeedsRows } from './hooks/useNeedsRows.js';
import { ambientProjectId } from './hooks/ambientProject.js';
import { useEventStream } from './hooks/useEventStream.js';
import { useVisitClock } from './hooks/useVisitClock.js';
import { useProjectVisits } from './hooks/useProjectVisits.js';
import { usePeekJump } from './hooks/usePeekJump.js';
import { usePlacePanel } from './hooks/usePlacePanel.js';
import { altChord, setShortcutsPaletteOpen, useGlobalShortcuts } from './hooks/useGlobalShortcuts.js';
import { useTypeToComposer } from './hooks/useTypeToComposer.js';
import { useRetiredSettingsRedirect, useSteeringRedirect, useTestingRedirect } from './hooks/useLegacyRedirect.js';
import { useMovedRoutes } from './hooks/useMovedRoutes.js';
import { EverythingPage } from './components/everything/EverythingPage.js';
import { everythingPath } from './board/everythingModel.js';
import { modePath, routedVersion, useRoute, type Mode } from './hooks/useRoute.js';
import { useRuns } from './hooks/useRuns.js';
import { useAnnotationStore } from './store/annotations.js';
import { useCampaignsStore } from './store/campaigns.js';
import { useGateStore } from './store/gates.js';
import { useElicitationStore } from './store/elicitations.js';
import { useLiveChatsStore } from './store/liveChats.js';
import { useNotificationStore } from './store/notifications.js';
import { useStallEscalationStore } from './store/stallEscalations.js';
import { useRuntimeStore } from './store/runtime.js';
import { useRunEventStore } from './store/events.js';
import { useDocThreadStore } from './store/docThread.js';
import { useCapabilities } from './store/capabilities.js';
import { useDecisionsStore } from './store/decisions.js';
import { useTeamPlanStore } from './store/teamPlan.js';
import { useWatchStore } from './store/watch.js';
import { useWatchHydrate } from './hooks/useWatchFeed.js';
import { WatchtowerPage } from './components/watch/WatchtowerPage.js';
import { RulesPage } from './components/rules/RulesPage.js';
import { needCount } from './board/needsQueue.js';
import type { CoreEvent, RepoEntry } from './api/types.js';
import { readSteeringTypeFilter } from './api/steering.js';
import { isTestingSubPage, readLaunchIntent } from './api/testing.js';
import { api } from './api/client.js';
import { useAppearanceStore } from './theming/appearance.js';
import { useNotifPrefsStore } from './store/notifPrefs.js';
import { useComposerPrefsStore } from './store/composerPrefs.js';
import { useViewPrefsStore } from './store/viewPrefs.js';
import { useDeliveryFreezeStore } from './store/deliveryFreeze.js';
import { notifyGateIfUnfocused } from './board/desktopNotify.js';
import { sessionPath } from './board/sessionModel.js';
import { sizeOf, versionOf } from './board/artifactAddress.js';

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
/** The expanded RightPanel's width (`w-72`) — the Ask launcher stays clear of it. */
const RIGHT_PANEL_PX = 288;
/** The Desk's Start row + composer band (skin `desk`): the Ask panel opens above it. */
const DESK_COMPOSER_PX = 96;

export function App(): React.ReactElement {
  const { panel, runId, repoId, projectId, mode, artifactId, showLaunch, showRegisterRepo, chatMode, campaignsView, campaignId, steeringSection, testingPage, ruleId, artifactKey, navigate, search, pathname } = useRoute();
  const { runs, refresh, loaded: runsLoaded, error: runsError } = useRuns();
  const movedRunChatId = useCapabilities((s) => s.runChatId);
  const ingestGate = useGateStore((s) => s.ingest);
  const ingestCampaign = useCampaignsStore((s) => s.ingest);
  const ingestAnnotation = useAnnotationStore((s) => s.ingest);
  const ingestElicitation = useElicitationStore((s) => s.ingest);
  const ingestNotif = useNotificationStore((s) => s.ingest);
  const ingestRuntime = useRuntimeStore((s) => s.ingest);
  const ingestRunEvent = useRunEventStore((s) => s.ingest);
  const ingestDocThread = useDocThreadStore((s) => s.ingest);
  const ingestLiveChat = useLiveChatsStore((s) => s.ingest);
  const ingestStallEscalation = useStallEscalationStore((s) => s.ingest);

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
      // S6a: relayed `wicked.team.*` rows grow the team-plan fold of every run a session shows.
      useTeamPlanStore.getState().ingest(event as unknown as { type: string } & Record<string, unknown>);
      // TR-W8: the Watchtower's fold — watch findings, team findings and the watchdog's frames.
      useWatchStore.getState().ingest(event as unknown as { type: string } & Record<string, unknown>);
      // J4 round 2: chat frames announce/retire live sessions for the rail's
      // Chat accordion — evidence this subscription already carries, no fetch.
      ingestLiveChat(event);
      // ASK-S1: the PA's deltas and reply grow the session thread before the transcript has them.
      useAskThreadStore.getState().ingest(event);
      // Wave 2b: the watchdog's needs-a-human escalations feed the needs-you queue.
      ingestStallEscalation(event);
      // DC-S6: `chatDecisions` (the line under the operator's message) and `decisionChanged` (ids only).
      useDecisionsStore.getState().ingest(event as unknown as { type: string } & Record<string, unknown>);
      // TH-14: fold core's Campaign* frames (a cheap prefix miss for everything else) so the
      // campaign scoreboard's node status is live the moment the daemon relays them (TH-9).
      ingestCampaign(event);
      // Slice L (DES-FEEDBACK-002 §8.2): the desktop layer folds off the SAME
      // subscription — hidden-tab-only, opt-in, permission-gated, never prompts.
      notifyGateIfUnfocused(event);
      if (LIFECYCLE_EVENTS.has(event.type)) refresh();
    },
    [ingestGate, ingestCampaign, ingestAnnotation, ingestElicitation, ingestNotif, ingestRuntime, ingestRunEvent, ingestDocThread, ingestLiveChat, ingestStallEscalation, refresh],
  );

  useEventStream(handleEvent);
  // TR-W8: finished and delivered runs are Watchtower rows, from the run list studio already reads.
  useEffect(() => { useWatchStore.getState().runs(runs); }, [runs]);
  useWatchHydrate();

  // Wave 2b: the operator's visit clock — an absence past the threshold opens a handover.
  useVisitClock();
  // Wave 2b: per-project last route + scroll, and the snapshot a return is briefed against.
  useProjectVisits(projectId, pathname + search, runs, runsLoaded);

  // Per-install appearance (DES-VISION-001 §3.3): one startup read of crew's
  // settings store; `studio.appearance` lands as inline custom-property
  // overrides on <html> — the cascade seam tokens.css declares for this.
  useEffect(() => {
    void useAppearanceStore.getState().load();
    // Slice L: `studio.notifications` rides the same settings store — read
    // once at startup; the defaults (Off) stand if the surface is absent.
    // Never touches the Notification API (EC25: no prompt on load).
    void useNotifPrefsStore.getState().load();
    // studio#123: `studio.composer` rides the same settings store — read once
    // at startup; the default (open a PR when a build run finishes) stands if
    // the surface, or the key, is absent.
    void useComposerPrefsStore.getState().load();
    // S3: `studio.view` ("Show technical details") — read once at startup; off stands if the
    // surface, or the key, is absent.
    void useViewPrefsStore.getState().load();
    // Idea 15: the delivery freeze — read once at startup (and again when an approve comes back
    // `deliveries_frozen`); a daemon without the route draws no switch.
    void useDeliveryFreezeStore.getState().load();
    // S6a: `capabilities.runChatId` (C1) — whether runs carry the chat they were launched from.
    void useCapabilities.getState().load();
    // DC-S6: the daemon's `WICKED_DECISIONS` mode (`GET /decisions`); `off` without the route.
    void useDecisionsStore.getState().load();
  }, []);

  // Pre-merge bookmarks (`/runs/:id`, `/projects/:id`) redirect into the shell (§1.5).

  // Bare `/steering`, a legacy `/steering/:type`, the retired governance panels
  // (`/wiki`/`/rules`/`/policies`) and the retired standalone `/proposals` queue normalize onto
  // the unified surface's two sub-sections (`/steering/policies[?type=]` or `/steering/memories`).
  useSteeringRedirect(panel, steeringSection, pathname, search, navigate);

  // The retired `/coverage` and `/domain` settings panels normalize onto `/system`.
  useRetiredSettingsRedirect(pathname, navigate);

  // The retired flat campaign addresses (`/campaigns`, `/campaigns/:id`) rewrite onto
  // `/testing/campaigns[...]`, and any page-less `/testing` address normalizes onto Evals
  // (the nav-reorg's renamed section home; Campaigns moved into the project shell).
  useTestingRedirect(panel, testingPage, pathname, navigate);

  // S15c (§5.4): the list and dashboard addresses that moved onto "See everything" — `/projects`,
  // `/chats`, `/work`, `/execute`, `/vibe`, `/demo`, `/make`, the bare `/runs`, `/p/:id/chronicle` —
  // are replaced with the live address; `/p/:id` goes to the project's newest session once the
  // runs are read. Not skin-scoped: an address is not a skin concern.
  useMovedRoutes({ panel, projectId, pathname, search, runs, runsLoaded, runsError, runChatId: movedRunChatId, navigate });

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

  // S16a-2d: a run opens its session thread (the run page retired); inside the project shell's Chat
  // mode a run stays in the chat (that address moves with S16a-4).
  const runPath = useCallback(
    (id: string) =>
      projectId && mode === 'chat'
        ? modePath(projectId, 'chat', id)
        : sessionPath(`run:${id}`),
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
    () => navigate(projectId && mode ? modePath(projectId, mode) : everythingPath({ tab: 'sessions' })),
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
  const [paletteObject, setPaletteObject] = useState<ObjectCommands | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  useEffect(() => trackPointedObject(), []);
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => {
    paletteOpenRef.current = paletteOpen;
    setShortcutsPaletteOpen(paletteOpen);
  }, [paletteOpen]);

  // ASK — the app-wide assist dock (AskDock): opened from the floating launcher
  // bubble (AskLauncher) or Ctrl/⌘+Shift+A; collapsing the dock closes it entirely.
  const [askOpen, setAskOpen] = useState(false);
  // The Desk composer's send (skin `desk`, S4): the message rides to the Ask dock, which sends it
  // as the operator's own question. `askKey` remounts the dock for each handoff; the text is spent
  // the moment the dock takes it (`onHandoffTaken`), and again whenever the dock closes, so no
  // reopen or re-render can send it twice or shadow letters typed to open the dock.
  const [askKey, setAskKey] = useState(0);
  const [askHandoff, setAskHandoff] = useState<{ text: string } & ComposerSend | null>(null);
  useEffect(() => {
    if (!askOpen) setAskHandoff(null);
  }, [askOpen]);
  const handToAsk = useCallback((text: string, opts: ComposerSend = {}) => {
    setAskKey((k) => k + 1);
    setAskHandoff({ text, ...opts });
    setAskOpen(true);
  }, []);
  const takeHandoff = useCallback(() => setAskHandoff(null), []);
  // §5.6 rule 4 (S2b): letters always type — into the open Ask dock, else the page's
  // composer, else the Ask dock opened with them (opening it only reads).
  useTypeToComposer(useCallback(() => setAskOpen(true), []));
  // studio#333: the Chat surface's bottom composer puts its Send in the bubble's corner.
  // GroupChat reports the band's LIVE height (a ResizeObserver — it grows with the scope
  // picker) and 0 on unmount; the launcher clears it exactly as it clears the right panel.
  const [chatComposerPx, setChatComposerPx] = useState(0);

  const shortcutEntries = useMemo(
    () => [
      ...paletteShortcutEntries({
        isOpen: () => paletteOpenRef.current,
        setOpen: (next: boolean) => {
          setPaletteSeed('');
          // S11: ⌘K acts on what you are pointing at (the open sheet's object, else the hovered or
          // focused one); with nothing pointed it is the plain palette.
          const obj = next ? cmdkObject() : null;
          setPaletteObject(obj === null ? null : objectCommands(obj, { runs: runsRef.current, navigate, runChatId: useCapabilities.getState().runChatId }));
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
      // Ctrl/⌘+Shift+A — the ASK toggle, documented in the shortcut overlay via the registry.
      {
        id: 'ask-dock',
        chord: { key: 'a', ctrlOrMeta: true, shift: true },
        group: 'panels' as const,
        description: 'Ask — governed answers about your projects, repos, and this studio',
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          setAskOpen((v) => !v);
        },
      },
      // ⌥W — the Watchtower's full feed (S14, DESIGN-interaction rule 10), from anywhere.
      {
        id: 'open-watchtower',
        chord: altChord('w'),
        group: 'navigate' as const,
        description: 'Open the Watchtower (the full feed)',
        handler: (e: KeyboardEvent) => {
          e.preventDefault();
          navigate('/watch');
        },
      },
    ],
    [runId, runs, onKill, navigate],
  );
  useGlobalShortcuts(shortcutEntries);

  // ── THE needs-you queue, app-wide: one fold over the app-level sources (useNeedsRows) —
  // the right rail renders it on every route, peek shows its top item, Home reads the same.
  const needsNow = useNeedsClock();
  const needRows = useNeedsRows(runs, needsNow, runsLoaded);

  // ── Studio wave 2a: peek (P), jump (G), back (B) — and the panels "back" reopens ──
  const peek = usePeekJump(runs, navigate, needRows);
  usePlacePanel('ask-dock', askOpen, setAskOpen);

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
        // The chronicle moved onto "See everything" (S15c): `/p/:id/chronicle` is a redirect, so
        // this dashboard never opens in its chronicle view any more.
        chronicleView={false}
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
        onComposerResize={setChatComposerPx}
      />
    </div>
  );

  // §4.3 pre-bind: `/p/:projectId/build/new` is the launch form LOCKED to the
  // project; the flat `/runs/new` stays unbound (Unfiled default, §5.1).
  const launchProjectId = projectId !== null && mode === 'build' && showLaunch ? projectId : null;

  // S16a-3: the run page retired — a run lives in its session thread (`/s/run%3A<id>`), so the run
  // surface is only the launch form (`/runs/new`, `/p/:pid/build/new`, `/chat/new`).
  const runSurface = (): React.ReactElement => (
    <div className="flex-1 overflow-y-auto">
      <LaunchPanel
        chatMode={chatMode}
        onLaunched={onLaunched}
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
    // The Demo mode (wicked-studio#373): a demo of a real local app, made by a governed run of the
    // `demo` preset (plan gate → record → review gate → watch). The artifact is the demo RUN.
    if (m === 'video') {
      return <DemoMode projectId={pid} runId={artifactId} runs={runs} navigate={navigate} />;
    }
    if (m === 'chat' && !artifactId) return groupChatSurface(null, pid);
    // S16a-3: a run inside the shell's Chat mode (`/p/:pid/chat/:run`, the address S16a-4e moves) is
    // its session thread — the run page that rendered it is gone.
    if (m === 'chat' && artifactId) {
      return <SessionPage sessionId={`run:${artifactId}`} runs={runs} runsLoaded={runsLoaded} needRows={needRows} navigate={navigate} onAsk={handToAsk} />;
    }
    // `showLaunch` here is `/p/:pid/build/new` — the §4.3 pre-bound launch form.
    return showLaunch ? runSurface() : dashboardSurface();
  }

  // Center panel content based on route
  function renderCenter(): React.ReactElement {
    // A dead address (usability review #4): the honest not-found view. Checked
    // FIRST — no redirect hook fires for this panel, so the typed URL stays.
    if (panel === 'not-found') {
      return (
        <div className="flex-1 overflow-y-auto">
          <NotFoundPage pathname={pathname} navigate={navigate} />
        </div>
      );
    }
    // The project shell owns every `/p/*` route and is checked FIRST — the panel parse
    // below is untouched and still owns the flat cross-project lists and side panels.
    if (projectId !== null && mode !== null) {
      return (
        <ProjectShell projectId={projectId} mode={mode} artifactId={artifactId} navigate={navigate} runs={runs}>
          {renderModeSurface(mode, projectId)}
        </ProjectShell>
      );
    }
    // `/p/:projectId/campaigns` (nav-reorg): the project-scoped Test surface — the test landing
    // re-homed under the project shell as a project-scoped VIEW (mode stays null), reached from
    // the project dashboard. See `ProjectCampaignsView` for the scoping caveats.
    if (projectId !== null && campaignsView) {
      return <ProjectCampaignsView projectId={projectId} runs={runs} navigate={navigate} />;
    }
    // "See everything" (`/everything`, S15c) — and the tick a moved address (`/projects`, `/work`,
    // `/chats`, `/execute`, `/vibe`, `/demo`, the bare `/runs`, `/p/:id[/chronicle]`) spends here
    // before `useMovedRoutes` replaces it. `/p/:id` renders the project's Sessions tab while the
    // newest session is found; with none, that tab is where it stays.
    if (panel === 'everything') {
      // Like the Desk: the page owns its scroller (`.wk-desk-scroll`) — no clipping wrapper (main_scroll).
      return <EverythingPage runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={refresh} needRows={needRows} navigate={navigate} search={search} routeProjectId={projectId} />;
    }
    // Wave 1 ("raw in one step"): a run's raw event JSON / worktree files as routes — the
    // palette's `>events <run>` / `>files <run>` verbs land here, and Back returns.
    if ((panel === 'run-events' || panel === 'run-files') && artifactId !== null) {
      return (
        <RunRawView
          target={panel === 'run-events' ? 'events' : 'files'}
          runId={artifactId}
          run={runs.find((v) => v.session.id === artifactId) ?? null}
          navigate={navigate}
        />
      );
    }
    // `/editors/{dev,conformance}` (EP-P1): one editor plugin in its sandboxed host, behind a dev route.
    if (panel === 'editors' && (artifactId === 'dev' || artifactId === 'conformance')) {
      return <EditorHostPage mode={artifactId} />;
    }
    // `/s/:id` (S6a): a session — under every skin (a route is not a skin concern).
    if (panel === 'session' && artifactId !== null) {
      return (
        <SessionPage
          sessionId={artifactId}
          artifactKey={artifactKey}
          artifactSize={sizeOf(search)}
          artifactVersion={versionOf(search)}
          runs={runs}
          runsLoaded={runsLoaded}
          needRows={needRows}
          navigate={navigate}
          onAsk={handToAsk}
        />
      );
    }
    // `/` is the orchestrator board (§1.4, slice 5); the flat run list it replaced is
    // still at `/runs`, which the `panel === 'runs'` fallback below keeps rendering.
    if (panel === 'home') {
      // The Desk (S4) — the one shell since the classic skins retired (S18d).
      return <Desk runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={refresh} needRows={needRows} now={needsNow} navigate={navigate} onAsk={handToAsk} />;
    }
    if (panel === 'workflows') {
      return (
        <div className="flex-1 overflow-y-auto p-6">
          <WorkflowViewer />
        </div>
      );
    }
    // `/steering/{dashboard,policies,memories}` — the unified governed-knowledge surface: ONE home,
    // a review-forward DASHBOARD (the default) plus two management deep-dives. The dashboard
    // un-buries the propose→promote review inbox; Memories renders the memory store; Policies (also
    // the tick before useSteeringRedirect lands for a legacy `/steering/:type` or the retired
    // `/wiki`/`/rules`/`/policies` addresses) renders the seven-type rule grid (the `?type=` filter
    // collapsing the old seven pages). Bare `/steering` and the retired `/proposals` queue redirect
    // to the dashboard.
    if (panel === 'steering') {
      // No page-level scroll wrapper here: each sub-section owns its layout — a two-column flex
      // (the management column scrolls, the assist dock is a full-height sibling — DES-ASSIST-DOCK §2).
      if (steeringSection === 'dashboard') {
        return (
          <div className="flex flex-1 overflow-hidden">
            <GovernanceDashboard navigate={navigate} />
          </div>
        );
      }
      if (steeringSection === 'memories') {
        return (
          <div className="flex flex-1 overflow-hidden">
            <MemoriesPanel />
          </div>
        );
      }
      return (
        <div className="flex flex-1 overflow-hidden">
          <SteeringPage
            type={readSteeringTypeFilter(search)}
            navigate={navigate}
            search={search}
            runs={runs}
          />
        </div>
      );
    }
    // `/skills` — the skills file manager over the daemon's effective plugin root (the skills
    // keystone): the catalog + KPI band, a drawer per skill (skill + support file trees, textarea
    // editor, enable/disable, reset, replace), and the page-level Publish that writes the snapshot
    // workers spawn with. `?skill=<name>` deep-links a drawer open. Same two-column shell as
    // Steering — the page owns its own scrolling column, so no page-level scroll wrapper.
    if (panel === 'skills') {
      return (
        <div className="flex flex-1 overflow-hidden">
          <SkillsPage navigate={navigate} search={search} />
        </div>
      );
    }
    // `/rules` and `/rules/:ruleId` — the Rules page (S12): DC's rule components on one frame, for
    // every skin; the steering grid stays reachable from it as "All rules".
    if (panel === 'rules') {
      return (
        <div className="flex flex-1 overflow-hidden">
          <RulesPage ruleId={ruleId} runs={runs} navigate={navigate} />
        </div>
      );
    }
    // `/watch` — the Watchtower (S14): TR's feed under every skin; its sentence is the needs-you count.
    if (panel === 'watch') {
      return (
        <div className="flex flex-1 overflow-hidden">
          <WatchtowerPage count={needCount(needRows)} runs={runs} navigate={navigate} now={needsNow} />
        </div>
      );
    }
    // `/mcp` — MCP tools (DES-MCP-TOOLS-001 §7): the registered servers, their tools, the policy
    // matrix and Approve / Revoke. `?server=<name>` deep-links a server row open.
    if (panel === 'mcp') {
      return (
        <div className="flex flex-1 overflow-hidden">
          <McpToolsPage navigate={navigate} search={search} />
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
    // `/testing/:page` — the Testing surface: ONE component, parameterized by sub-page
    // (Campaigns / Evals; the retired Harness folded into the Campaigns landing's verbs).
    // The campaign list + scoreboard (TH-14) live under it; a page-less address renders the
    // Campaigns landing for the tick before useTestingRedirect lands.
    if (panel === 'testing') {
      return (
        <div className="flex-1 overflow-y-auto">
          <TestingPage
            page={testingPage !== null && isTestingSubPage(testingPage) ? testingPage : 'campaigns'}
            campaignId={campaignId}
            runs={runs}
            navigate={navigate}
            // The landing's `?new=` arrival intent (the rail's ＋ / Run recon row — #203).
            launchIntent={readLaunchIntent(search)}
          />
        </div>
      );
    }
    // `/projects/:id` — the project management page (Edit + Archive/Restore).
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
    // The launch form; anything else with no surface of its own is the home dashboard (S16a-3: no
    // route renders a run page any more).
    return showLaunch ? runSurface() : dashboardSurface();
  }

  return (
    // One shell (S18d): the session rail on every route, the Desk on `/`. `data-shell="desk"` stays
    // stamped as a constant — e2e waits on it.
    <div className="flex h-screen overflow-hidden bg-surface-base" data-shell="desk">
      {/* The FIRST tabbable element (usability review #10): one Tab reaches a
          jump to the main content instead of a page's top-right Refresh. */}
      <SkipLink />
      <SessionRail runs={runs} needRows={needRows} navigate={navigate} pathname={pathname} />

      <div id="main" tabIndex={-1} className="flex flex-1 overflow-hidden" style={{ outline: 'none' }}>
        {renderCenter()}
      </div>

      {/* Right panel only when a run is selected */}
      {selected !== null && (
        <RightPanel view={selected} runs={runs} onSelectRun={selectRun} navigate={navigate} />
      )}

      {/* ASK — the floating chat bubble bottom-right (studio#323 R1) and, while open,
          the app-wide assist dock as a panel anchored to it — an overlay, never a
          layout column. The dock renders only while open; NOTHING launches until the
          user sends. Its session persists across close/reopen (AskDock, R3). */}
      <AskLauncher
        open={askOpen}
        onToggle={() => setAskOpen((v) => !v)}
        rightOffsetPx={selected !== null ? RIGHT_PANEL_PX : 0}
        bottomOffsetPx={panel === 'home' || panel === 'session' ? DESK_COMPOSER_PX : chatComposerPx}
        // The Desk and a session have their own composer in this corner: there the bubble stands down.
        bubble={!(panel === 'home' || panel === 'session')}
      >
        {askOpen && (
          <AskDock
            key={askKey}
            runs={runs}
            pathname={pathname}
            navigate={navigate}
            onClose={() => setAskOpen(false)}
            {...(askHandoff !== null ? {
              sendText: askHandoff.text,
              onHandoffTaken: takeHandoff,
              ...(askHandoff.projectId !== undefined ? { sendProjectId: askHandoff.projectId } : {}),
              ...(askHandoff.fresh === true ? { sendFresh: true } : {}),
              ...(askHandoff.primary !== undefined ? { sendPrimary: askHandoff.primary } : {}),
              ...(askHandoff.chatId !== undefined ? { sendChatId: askHandoff.chatId } : {}),
            } : {})}
          />
        )}
      </AskLauncher>

      {/* S11: the open "look underneath" sheet (a step, a helper, a session, the Desk). */}
      <ObjectSheet runs={runs} navigate={navigate} needCount={needCount(needRows)} />
      <AltPeek runs={runs} needCount={needCount(needRows)} />

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
        object={paletteObject}
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

      {/* The shortcut overlay (DES-UX-001 §7.7, EC42) — every route: this
          root renders on all of them, and the overlay's corpus is the registry
          itself, so each surface documents exactly the keys it registered. */}
      <ShortcutOverlay />

      {/* Wave 2a: the peek card (P) and the gate-decision Undo toasts — skins over
          usePeekJump and board/undoQueue. */}
      <PeekCard view={peek} />
      <UndoToasts />

      {/* The lost-connection banner (crew#551): names the one-line fix while /ws is down. */}
      <ConnectionStatus />

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
