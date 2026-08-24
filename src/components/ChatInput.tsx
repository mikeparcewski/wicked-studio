import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { EntityMode, LaunchRunBody, Project, RepoEntry, RosterSeat, WorkflowDef } from '../api/types.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from './composerDefaults.js';
import { isShortcutsPaletteOpen } from '../hooks/useGlobalShortcuts.js';
import { useGateStore } from '../store/gates.js';
import { anyModalOpen, useLayerStore } from '../store/layers.js';
import { useProvenanceStore } from '../store/provenance.js';
import { clearRetryPrefill, confirmModeOf, peekRetryPrefill, type RetryPrefill } from '../store/retryPrefill.js';
import { clearSteerPrefill, peekSteerPrefill } from '../store/steerPrefill.js';
import { setCachedRoster } from '../store/rosterCache.js';
import { ContextPopover } from './ContextPopover.js';
import type { ConfirmMode } from './ContextPopover.js';
import { NewProjectModal } from './NewProjectModal.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';
import type { RunMode } from './runMode.js';

interface Props {
  /** If set, we're in "run selected" mode — steer if gated, inject if executing, placeholder otherwise. */
  runId?: string | null;
  /** The current status of the selected run. Used to decide steer vs inject vs disabled mode. */
  runStatus?: string | null;
  onLaunched: (runId: string) => void;
  /**
   * When true, renders inline (no footer border/background) so the widget can sit
   * centered in the empty-state layout rather than docked to the bottom of the pane.
   */
  embedded?: boolean;
  /** When set, forces this workflow id on every launch (overrides the popover selector). */
  workflowOverride?: string;
  /**
   * Active run mode (Ask / Balanced / Autonomous). When provided, overrides the
   * confirmMode selection from the context popover with the mode-derived value.
   */
  mode?: RunMode;
  /**
   * Inject target for mid-run messaging: "all" broadcasts to every active worker;
   * any other value targets a specific CLI key. Defaults to "all" when absent.
   */
  injectTarget?: string;
  /** Called when the user clears the agent-specific inject target (resets to "all"). */
  onClearInjectTarget?: () => void;
  /**
   * App-level route navigation (App.tsx's useRoute().navigate), threaded down so the
   * seat sign-in warning can jump to Settings (/system). Optional — surfaces without
   * it just render the warning with no working link.
   */
  navigate?: (path: string) => void;
  /**
   * §4.3 pre-bind (DES-FEEDBACK-001, slice B): when set, the launch form's
   * ProjectSwitcher pre-fills with this project and LOCKS, and every launch
   * carries `projectId` in the POST body. When absent the field defaults to
   * Unfiled (§5.1) — NO `projectId` key on the body, the backend default.
   */
  lockedProjectId?: string | null;
}

const INJECT_STATUSES = new Set(['executing', 'distributing', 'planning']);

function detectWorkflow(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)) return 'bug';
  if (
    /\b(feature|implement|add|create)\b/.test(lower) &&
    !/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)
  )
    return 'feature';
  if (/\b(migrate|upgrade|migration|move)\b/.test(lower)) return 'migration';
  return null;
}

/** Small × pill for active non-default options */
function ActivePill({
  label,
  onClear,
  attrs,
}: {
  label: string;
  onClear: () => void;
  /** Extra data-* attributes (the §7.8 repo chip's auto-attached marker). */
  attrs?: Record<string, string>;
}): React.ReactElement {
  return (
    <span
      {...attrs}
      className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-mono"
      style={{
        background: 'var(--surface-raised)',
        color: 'var(--ink-muted)',
        border: '1px solid var(--surface-raised)',
      }}
    >
      {label}
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear ${label}`}
        className="opacity-60 hover:opacity-100 leading-none ml-0.5"
      >
        ×
      </button>
    </span>
  );
}



// Defense-in-depth denylist: catches system workflows that predate the is_system flag.
const SYSTEM_WORKFLOW_IDS = new Set(['chat', 'onboarding', 'survey-repo', 'domain-graph-slice', 'memories']);

export function ChatInput({ runId, runStatus, onLaunched, embedded, workflowOverride, mode, injectTarget, onClearInjectTarget, navigate, lockedProjectId = null }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);

  // Retry-as-prefill (DES-UX-001 §4.3): the LAUNCH-FORM composer consumes a
  // pending retry prefill ONCE at mount. PEEK in the lazy initializer (which
  // StrictMode double-invokes in dev — an initializer-side take() would
  // consume on the discarded first pass and commit an EMPTY composer), then
  // clear in the commit effect below. Run-selected composers (steer/inject)
  // never consume it.
  const [prefill] = useState<RetryPrefill | null>(() => (runId ? null : peekRetryPrefill()));
  useEffect(() => {
    if (prefill !== null) clearRetryPrefill();
  }, [prefill]);
  /** Lineage claim carried to the launch (`retryOf`, CREW-UX-3) — clearable. */
  const [retryOf, setRetryOf] = useState<string | null>(prefill?.retryOf ?? null);

  // Guidance-as-prefill (DES-UX-002 §3.3, slice BC): the chronicle's "use in
  // next run" deposits a past gate amendment; the launch form shows it in an
  // EDITABLE steer field and folds it into the problem body at launch — the
  // wire has no launch-time guidance field (CREW-UX-4/slice BE is the durable
  // one), so the fold is visible, labelled, and clearable, never silent.
  const [steerSeed] = useState(() => (runId ? null : peekSteerPrefill()));
  useEffect(() => {
    if (steerSeed !== null) clearSteerPrefill();
  }, [steerSeed]);
  const [launchSteer, setLaunchSteer] = useState(steerSeed?.steer ?? '');

  // ── Steer mode state ───────────────────────────────────────────────────────
  const [steerText, setSteerText] = useState('');
  const [steering, setSteering] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const steerRef = useRef<HTMLTextAreaElement>(null);

  // ── Inject mode state ─────────────────────────────────────────────────────
  const [injectText, setInjectText] = useState('');
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState<string | null>(null);
  // Synchronous guard prevents a second inject from firing before the first
  // setInjecting(true) call re-renders the disabled state.
  const injectInflightRef = useRef(false);

  // ── Launch form state — a retry prefill seeds the initial values (§4.3);
  //    everything stays fully editable before send. ──────────────────────────
  const [problem, setProblem] = useState(prefill?.problem ?? '');
  const [workflow, setWorkflow] = useState(prefill?.workflowId ?? '');
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const selectableWorkflows = useMemo(
    () => workflows.filter((w) => !w.is_system && !SYSTEM_WORKFLOW_IDS.has(w.id)),
    [workflows],
  );
  const [selectedClis, setSelectedClis] = useState<Set<string>>(new Set());
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoRefs, setRepoRefs] = useState<string[]>(prefill?.repoRef ? [prefill.repoRef] : []);
  const [entityMode, setEntityMode] = useState<EntityMode>(prefill?.entityMode ?? 'shared');
  // Gate posture (DES-UX-001 §7.8 + §13, slice AC): the shipped default is
  // COMPOSER_DEFAULT_GATE_POSTURE (human_confirm before the first gate-bearing
  // unit — no longer "none"); a retry prefill still reproduces the ORIGINAL
  // run's posture, whatever it was (§4.3 — the prefill is the original).
  const prefillGate = confirmModeOf(prefill?.humanConfirm);
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>(
    prefill !== null ? prefillGate.mode : COMPOSER_DEFAULT_GATE_POSTURE.mode,
  );
  const [beforeOrd, setBeforeOrd] = useState(
    prefill !== null ? prefillGate.beforeOrd : COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd,
  );
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  // ── Preflight (DES-UX-001 §7.8, EC43, slice AC) ────────────────────────────
  // A code-shaped intent with no repo attached warns-and-blocks: zero POST
  // /runs until the operator attaches one or explicitly overrides.
  const [preflightBlocked, setPreflightBlocked] = useState(false);

  // Auto-attach (§7.8): a project's bound repo (`crew.repo` membership) rides
  // the launch by default — visibly, as a removable chip (auto is a default,
  // not a lock). `reposTouched` = the operator has spoken; auto never wins.
  const [autoAttached, setAutoAttached] = useState(false);
  const reposTouched = useRef(prefill?.repoRef != null);
  const repoRefsRef = useRef(repoRefs);
  repoRefsRef.current = repoRefs;
  const autoTriedFor = useRef<string | null>(null);

  function touchRepoRefs(refs: string[]): void {
    reposTouched.current = true;
    setAutoAttached(false);
    setRepoRefs(refs);
  }

  // ── Project binding (DES-FEEDBACK-001 §5, slice B) ─────────────────────────
  // `null` = Unfiled (§5.1): no `projectId` key in the POST body, the backend
  // default — byte-identical to the pre-slice request. The list loads lazily on
  // the dropdown's first open (or on mount when pre-bound, to resolve the name).
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(prefill?.projectId ?? null);
  const [showNewProject, setShowNewProject] = useState(false);
  const projectsRequested = useRef(false);

  function loadProjects(): void {
    if (projectsRequested.current) return;
    projectsRequested.current = true;
    api
      .listProjects()
      .then(({ projects: ps }) =>
        // Recency-ordered (updated_at desc) — the attention axis's cheap proxy;
        // the synthesized `default` row is filtered by the switcher itself.
        setProjects([...ps].sort((a, b) => b.updated_at - a.updated_at)))
      .catch(() => {
        projectsRequested.current = false; // transient failure — retry on next open
      });
  }

  const [submitting, setSubmitting] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detectedWorkflow, setDetectedWorkflow] = useState<string | null>(null);
  const [workflowDismissed, setWorkflowDismissed] = useState(false);

  // ── Popover state ──────────────────────────────────────────────────────────
  const [popoverOpen, setPopoverOpen] = useState(false);
  /** Wraps the + button AND the absolutely-positioned popover for outside-click detection. */
  const popoverAnchorRef = useRef<HTMLDivElement>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Data loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    api
      .getRoster()
      .then(({ roster: seats }) => {
        // Deposit for Chat's default chips (§6.1: cached, never fetched on mount).
        setCachedRoster(seats);
        setRoster(seats);
        // A retry prefill's roster wins over the stored/default selection —
        // §4.3: the composer opens matching the ORIGINAL run, editable after.
        if (prefill !== null) {
          setSelectedClis(new Set(prefill.clis));
          return;
        }
        try {
          const stored = localStorage.getItem('wicked_default_clis');
          if (stored) {
            setSelectedClis(new Set(JSON.parse(stored) as string[]));
            return;
          }
        } catch { /* ignore */ }
        setSelectedClis(new Set(seats.filter((s) => s.enabled_for_council).map((s) => s.key)));
      })
      .catch(() => {
        /* roster load failure is non-fatal */
      });
    api
      .listRepos()
      .then(({ repos: rs }) => setRepos(rs))
      .catch(() => {});
    api
      .listWorkflows()
      .then(({ workflows: wfs }) => setWorkflows(wfs))
      .catch(() => {});
    // `prefill` is lazy-initialized state: stable for the component's lifetime,
    // so this still runs exactly once per mount.
  }, [prefill]);

  // §4.3 pre-bound: resolve the locked project's NAME up front — the field must
  // show the name, not the id. Unbound forms load nothing until the first open.
  // A retry prefill's project binding needs the same name resolution (§4.3).
  useEffect(() => {
    if (lockedProjectId != null || prefill?.projectId != null) loadProjects();
    // (loadProjects is ref-guarded and single-shot, so listing only the lock is safe.)
  }, [lockedProjectId, prefill]);

  // §7.8 auto-attach: entering the composer bound to a project reads that
  // project's members once (the same wire ProjectDashboard already reads) and
  // attaches its `crew.repo` refs — only while the operator hasn't touched the
  // repo selection, and never over an existing selection or a retry prefill.
  useEffect(() => {
    if (runId) return; // launch form only — steer/inject composers never attach
    const pid = lockedProjectId ?? selectedProjectId;
    if (pid == null || pid === 'default') return;
    if (reposTouched.current || autoTriedFor.current === pid) return;
    autoTriedFor.current = pid;
    let cancelled = false;
    api
      .listProjectMembers(pid)
      .then(({ members }) => {
        if (cancelled || reposTouched.current || repoRefsRef.current.length > 0) return;
        const refs = members.filter((m) => m.member_kind === 'crew.repo').map((m) => m.member_ref);
        if (refs.length === 0) return;
        setRepoRefs(refs);
        setAutoAttached(true);
      })
      .catch(() => {
        autoTriedFor.current = null; // transient — retry on the next binding change
      });
    return () => {
      cancelled = true;
    };
  }, [runId, lockedProjectId, selectedProjectId]);

  // ── Elapsed-time ticker ────────────────────────────────────────────────────
  useEffect(() => {
    if (submitting) {
      setElapsedSecs(0);
      timerRef.current = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setElapsedSecs(0);
    }
    return () => {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [submitting]);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxHeight = 20 * 5; // 5 lines × 20 px line-height
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [problem]);

  // ── Workflow signal detection ───────────────────────────────────────────────
  useEffect(() => {
    if (!problem.trim() || workflow || workflowOverride) {
      setDetectedWorkflow(null);
      return;
    }
    setDetectedWorkflow(detectWorkflow(problem));
  }, [problem, workflow, workflowOverride]);

  // ── Close popover on outside click ─────────────────────────────────────────
  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent): void {
      if (
        popoverAnchorRef.current &&
        !popoverAnchorRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [popoverOpen]);

  // ── Close popover on Escape ────────────────────────────────────────────────
  // §7.7 (slice AC): a popover rung — yields to the '?' overlay, the palette,
  // and any open modal above it (one press, one layer).
  useEffect(() => {
    if (!popoverOpen) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (useLayerStore.getState().shortcutOverlayOpen) return;
      if (isShortcutsPaletteOpen()) return;
      if (anyModalOpen()) return;
      setPopoverOpen(false);
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [popoverOpen]);

  // ── Helpers ────────────────────────────────────────────────────────────────
  function toggleCli(key: string): void {
    setSelectedClis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function resetCliSelection(): void {
    setSelectedClis(
      new Set(roster.filter((s) => s.enabled_for_council).map((s) => s.key)),
    );
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function submit(preflightOverride = false): Promise<void> {
    if (!problem.trim() || selectedClis.size === 0 || submitting) return;
    // §7.8 preflight (EC43): a code-shaped intent — an explicit workflow, or
    // the detector reading one from the text — launched with no repo attached
    // cannot produce reviewable work. Warn-and-block: ZERO POST /runs until a
    // repo attaches or the operator overrides ("Launch anyway").
    const codeShaped = Boolean(workflowOverride?.trim() || workflow || detectWorkflow(problem));
    if (!preflightOverride && codeShaped && repoRefs.length === 0) {
      setPreflightBlocked(true);
      return;
    }
    setPreflightBlocked(false);
    setSubmitting(true);
    setError(null);

    // TODO: ingest attachedFiles via api.ingestKnowledge(title, chunks) before launching
    // (api.ingestKnowledge does not yet exist on the client surface)

    // The steer prefill rides the problem body as a labelled trailing
    // paragraph (see the steer field's own caption) — LaunchRunBody carries
    // no guidance key until CREW-UX-4 lands (DES-UX-002 §7.2).
    const guidance = launchSteer.trim();
    const body: LaunchRunBody = {
      problem: guidance.length > 0 ? `${problem.trim()}\n\nOperator guidance: ${guidance}` : problem.trim(),
    };
    const seats = roster.filter((s) => selectedClis.has(s.key));
    if (seats.length > 0) body.clisJson = JSON.stringify(seats);
    body.entityMode = entityMode;
    // Ask → gate all; Autonomous → no human gates (confirmMode selection ignored); Balanced/unset → popover applies.
    if (mode === 'ask') {
      body.humanConfirm = 'all';
    } else if (mode !== 'autonomous') {
      if (confirmMode === 'all') body.humanConfirm = 'all';
      else if (confirmMode === 'before') body.humanConfirm = `before:${beforeOrd}`;
    }
    const firstRepo = repoRefs[0];
    if (firstRepo) body.repoRef = firstRepo;
    const wf = workflowOverride?.trim() || workflow;
    if (wf) body.workflow = wf;
    // §5.1: Unfiled = NO projectId key at all (the backend default); a selected
    // or pre-bound project files the run atomically with the launch.
    const boundProject = lockedProjectId ?? selectedProjectId;
    if (boundProject) body.projectId = boundProject;
    // Lineage (§4.3, CREW-UX-3): recorded in the system of record at launch —
    // never inferred from prompt equality. The pill above is the operator's
    // way to drop the claim before sending.
    if (retryOf) body.retryOf = retryOf;

    try {
      const { runId: newRunId } = await api.launchRun(body);
      // The studio witnessed this launch — the provenance line's honest
      // 'via studio' channel derives from exactly this record (§3.3).
      useProvenanceStore.getState().markLaunchedHere(newRunId);
      setProblem('');
      onLaunched(newRunId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ── Steer submit ───────────────────────────────────────────────────────────
  async function submitSteer(): Promise<void> {
    const text = steerText.trim();
    if (!text || !runId) return;
    setSteering(true);
    setSteerError(null);
    try {
      await api.confirmGate(runId, { approve: true, amend: text });
      setSteerText('');
      clearGate(runId);
    } catch (err) {
      setSteerError(err instanceof Error ? err.message : String(err));
    } finally {
      setSteering(false);
    }
  }

  // ── Inject submit ──────────────────────────────────────────────────────────
  async function submitInject(): Promise<void> {
    const text = injectText.trim();
    if (!text || !runId || injectInflightRef.current) return;
    injectInflightRef.current = true;
    setInjecting(true);
    setInjectError(null);
    const target = injectTarget?.trim() || 'all';
    try {
      await api.injectMessage(runId, text, target);
      setInjectText('');
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : String(err));
    } finally {
      injectInflightRef.current = false;
      setInjecting(false);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Run-selected mode: steer at gates, inject if executing, placeholder otherwise
  // ══════════════════════════════════════════════════════════════════════════

  if (runId) {
    if (runStatus === 'awaiting_human') {
      const canSteer = steerText.trim().length > 0 && !steering;
      return (
        <div
          className="px-5 py-4 flex flex-col gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
        >
          {steerError && (
            <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)' }}>
              {steerError}
            </p>
          )}
          <div
            className="flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--status-gate-dim)' }}
          >
            <textarea
              ref={steerRef}
              className="flex-1 resize-none text-base outline-none border-0 bg-transparent leading-6"
              style={{ minHeight: '28px', color: 'var(--ink-high)', fontFamily: 'inherit' }}
              placeholder="Send steering guidance… (approves gate)"
              value={steerText}
              onChange={(e) => setSteerText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submitSteer();
                }
              }}
              disabled={steering}
              rows={1}
            />
            <button
              type="button"
              onClick={() => void submitSteer()}
              disabled={!canSteer}
              className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {steering ? '…' : 'Steer →'}
            </button>
          </div>
          <p
            className="text-[10px] font-mono text-center"
            style={{ color: 'var(--ink-dim)' }}
          >
            Approve + steer · Cmd+Enter · Use the gate panel above to approve/reject without steering
          </p>
        </div>
      );
    }

    // Executing statuses — inject a message into the active worker(s).
    if (runStatus && INJECT_STATUSES.has(runStatus)) {
      const canInject = injectText.trim().length > 0 && !injecting;
      const normalizedTarget = injectTarget?.trim() || 'all';
      const isTargeted = normalizedTarget !== 'all';
      const targetLabel = isTargeted ? normalizedTarget : 'all agents';
      return (
        <div
          className="px-5 py-4 flex flex-col gap-2 shrink-0"
          style={{ borderTop: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
        >
          {injectError && (
            <p className="text-[11px] font-mono" style={{ color: 'var(--status-fail)' }}>
              {injectError}
            </p>
          )}
          <div
            className="flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
          >
            <textarea
              className="flex-1 resize-none text-base outline-none border-0 bg-transparent leading-6"
              style={{ minHeight: '28px', color: 'var(--ink-high)', fontFamily: 'inherit' }}
              placeholder={`Send message to ${targetLabel}…`}
              value={injectText}
              onChange={(e) => setInjectText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void submitInject();
                }
              }}
              disabled={injecting}
              rows={1}
            />
            <button
              type="button"
              onClick={() => void submitInject()}
              disabled={!canInject}
              className="shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {injecting ? '…' : 'Send →'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            {/* Subtle mode chip: this composer is steering a LIVE run (messages inject
                into the active worker turn), not launching a new one. */}
            <span
              data-testid="steering-live-chip"
              className="flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-mono shrink-0"
              style={{ background: 'var(--status-run-dim)', color: 'var(--status-run)', border: '1px solid var(--status-run-dim)' }}
            >
              <span className="inline-block w-1 h-1 rounded-full animate-pulse" style={{ background: 'var(--status-run)' }} />
              steering live run
            </span>
            <p
              className="text-[10px] font-mono flex-1"
              style={{ color: 'var(--ink-dim)' }}
            >
              Cmd+Enter · Click an agent to target it
            </p>
            {isTargeted && (
              <span
                className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-mono"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--accent-subtle)' }}
              >
                → {normalizedTarget}
                {onClearInjectTarget && (
                  <button
                    type="button"
                    onClick={onClearInjectTarget}
                    aria-label="Clear target, broadcast to all"
                    className="opacity-60 hover:opacity-100 leading-none ml-0.5"
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      );
    }

    // Terminal or otherwise inactive — nothing to do.
    return (
      <div
        className="px-5 py-4 shrink-0"
        style={{ borderTop: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
      >
        <div
          className="rounded-2xl px-5 py-4"
          style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
        >
          <p className="text-sm italic font-mono" style={{ color: 'var(--ink-dim)' }}>
            Steer at the next gate.
          </p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Launch form (no run selected)
  // ══════════════════════════════════════════════════════════════════════════

  const canSubmit = problem.trim().length > 0 && selectedClis.size > 0 && !submitting;
  const showDetection = detectedWorkflow !== null && !workflowDismissed && !workflow && !workflowOverride;

  // The switcher's current binding (§5.2). Pre-bound (§4.3): the project rides
  // the route, so it shows even before the name resolves — id first, name once
  // the list lands (fixture/daemon ids are stable slugs, so this never flashes
  // an unrelated string).
  const boundProjectId = lockedProjectId ?? selectedProjectId;
  const currentProject: Project | null =
    projects.find((p) => p.id === boundProjectId)
    ?? (lockedProjectId != null
      ? { id: lockedProjectId, name: lockedProjectId, description: null,
          status: 'active', scope: `project:${lockedProjectId}`, created_at: 0, updated_at: 0 }
      : null);

  // Seats routed to by this launch that the daemon observed as NOT signed in.
  // Strictly `=== false` — `null`/absent means "unknowable cheaply", not a problem.
  // A warning only: fallbacks exist, so the launch is never blocked on it.
  const unsignedSelected = roster.filter(
    (s) => selectedClis.has(s.key) && s.signed_in === false,
  );

  // Determine whether CLIs differ from the defaults that loaded from the roster
  const defaultCliSet = new Set(
    roster.filter((s) => s.enabled_for_council).map((s) => s.key),
  );
  const clisDirty =
    selectedClis.size !== defaultCliSet.size ||
    [...selectedClis].some((k) => !defaultCliSet.has(k));

  // Collect active non-default option pills
  const activePills: Array<{ label: string; onClear: () => void; attrs?: Record<string, string> }> = [];

  // The lineage claim leads the pills (§4.3): visible, and clearable — a retry
  // is a composer prefill the operator may edit down to a fresh launch.
  if (retryOf) {
    activePills.push({
      label: `Retry of ${retryOf.slice(0, 8)}`,
      onClear: () => setRetryOf(null),
    });
  }
  if (attachedFiles.length > 0) {
    activePills.push({
      label: `${attachedFiles.length} file${attachedFiles.length !== 1 ? 's' : ''} attached`,
      onClear: () => setAttachedFiles([]),
    });
  }
  if (confirmMode !== 'none') {
    activePills.push({
      label: confirmMode === 'all' ? 'Gate: every unit' : `Gate: before #${beforeOrd}`,
      onClear: () => setConfirmMode('none'),
    });
  }
  if (entityMode === 'isolated') {
    activePills.push({
      label: 'Mode: isolated',
      onClear: () => setEntityMode('shared'),
    });
  }
  if (workflow) {
    activePills.push({
      label: `Workflow: ${workflow}`,
      onClear: () => {
        setWorkflow('');
        setWorkflowDismissed(true);
      },
    });
  }
  for (const rid of repoRefs) {
    const found = repos.find((r) => r.id === rid);
    activePills.push({
      label: `Repo: ${found?.name ?? rid}${autoAttached ? ' (from project)' : ''}`,
      // Removing an auto-attached chip is the operator speaking (§7.8: auto is
      // a default, not a lock) — auto never re-attaches afterwards.
      onClear: () => touchRepoRefs(repoRefs.filter((id) => id !== rid)),
      attrs: {
        'data-testid': 'repo-chip',
        'data-repo-ref': rid,
        'data-auto-attached': autoAttached ? 'true' : 'false',
      },
    });
  }
  if (clisDirty && roster.length > 0) {
    activePills.push({
      label: `CLIs: ${[...selectedClis].join(', ')}`,
      onClear: resetCliSelection,
    });
  }

  return (
    <div
      className={`flex flex-col gap-3 ${embedded ? '' : 'px-5 py-4 shrink-0'}`}
      style={
        embedded
          ? {}
          : {
              borderTop: '1px solid var(--surface-raised)',
              background: 'var(--surface-rail)',
            }
      }
    >
      {/* ── Project binding — the FIRST field of every create flow (§5.2) ──
          Unfiled by default; pre-bound-and-locked from project context (§4.3). */}
      <div className="flex items-center gap-2 px-1" data-testid="launch-project-row">
        <span
          className="text-[11px] font-mono uppercase tracking-widest"
          style={{ color: 'var(--ink-dim)' }}
        >
          Project
        </span>
        <ProjectSwitcher
          current={currentProject}
          projects={projects}
          onSelect={setSelectedProjectId}
          onNewProject={() => setShowNewProject(true)}
          onOpen={loadProjects}
          locked={lockedProjectId != null}
          // Docked (non-embedded) forms sit at the pane's bottom edge — open up.
          dropUp={!embedded}
        />

        {/* ── Gate posture at top level (§7.8, slice AC) — the + drawer keeps
            the full matrix; this is the always-visible control whose shipped
            default is COMPOSER_DEFAULT_GATE_POSTURE (never "none"). ── */}
        <span
          className="text-[11px] font-mono uppercase tracking-widest ml-auto"
          style={{ color: 'var(--ink-dim)' }}
        >
          Gate
        </span>
        <select
          data-testid="gate-posture"
          aria-label="Gate posture"
          title="When a human confirms this run's units — default: before the first gate-bearing unit"
          className="rounded-lg px-2 py-1 text-[11px] font-mono"
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--surface-raised)',
            color: 'var(--ink-high)',
          }}
          value={confirmMode}
          onChange={(e) => setConfirmMode(e.target.value as ConfirmMode)}
        >
          <option value="before">{beforeOrd === 1 ? 'First gate' : `Before unit #${beforeOrd}`}</option>
          <option value="all">Every unit</option>
          <option value="none">No gates</option>
        </select>
      </div>

      {showNewProject && (
        <NewProjectModal
          navigate={navigate ?? ((): void => undefined)}
          onClose={() => setShowNewProject(false)}
        />
      )}

      {/* Workflow detection hint */}
      {showDetection && (
        <div
          className="flex items-center gap-2 text-xs rounded-xl px-4 py-2 font-mono"
          style={{
            background: 'var(--surface-rail)',
            border: '1px solid var(--surface-raised)',
            color: 'var(--ink-muted)',
          }}
        >
          <span>
            Detected: <strong style={{ color: 'var(--accent)' }}>{detectedWorkflow}</strong> workflow
          </span>
          <button
            type="button"
            onClick={() => {
              setWorkflow(detectedWorkflow!);
              setWorkflowDismissed(true);
            }}
            className="rounded-lg px-3 py-1 font-semibold text-xs"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setWorkflowDismissed(true)}
            className="ml-auto"
            style={{ color: 'var(--ink-dim)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Seat sign-in warning — selected seats observed as signed_in === false */}
      {unsignedSelected.length > 0 && (
        <div
          data-testid="signin-warning"
          className="flex items-center gap-2 text-xs rounded-xl px-4 py-2 font-mono"
          style={{
            background: 'var(--status-fail-dim)',
            border: '1px solid var(--status-fail-dim)',
            color: 'var(--status-fail)',
          }}
        >
          <span className="flex-1">
            ⚠ {unsignedSelected.map((s) => s.key).join(', ')}{' '}
            {unsignedSelected.length === 1 ? "isn't" : "aren't"} signed in — runs routed there
            will fall back or fail. Sign in in Settings.
          </span>
          <button
            type="button"
            onClick={() => navigate?.('/system')}
            className="rounded-lg px-3 py-1 font-semibold text-xs shrink-0"
            style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
          >
            Open Settings
          </button>
        </div>
      )}

      {/* ── Preflight warn-and-block (§7.8, EC43) — a code intent with no repo
          fired zero POST /runs to get here; the override is the only way past
          without attaching. ── */}
      {preflightBlocked && repoRefs.length === 0 && (
        <div
          data-testid="preflight-block"
          className="flex items-center gap-2 text-xs rounded-xl px-4 py-2 font-mono"
          style={{
            background: 'var(--status-gate-dim)',
            border: '1px solid var(--status-gate-dim)',
            color: 'var(--status-gate)',
          }}
        >
          <span className="flex-1">
            ⚠ No repository attached — the run cannot produce reviewable work.
            Attach one, or launch anyway.
          </span>
          <button
            type="button"
            data-testid="preflight-attach"
            onClick={() => setPopoverOpen(true)}
            className="rounded-lg px-3 py-1 font-semibold text-xs shrink-0"
            style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
          >
            Attach a repo
          </button>
          <button
            type="button"
            data-testid="preflight-override"
            onClick={() => void submit(true)}
            className="rounded-lg px-3 py-1 font-semibold text-xs shrink-0"
            style={{
              background: 'var(--surface-raised)',
              color: 'var(--ink-muted)',
              border: '1px solid var(--ink-dim)',
            }}
          >
            Launch anyway
          </button>
        </div>
      )}

      {/* ── Guidance steer field (DES-UX-002 §3.3, slice BC) — rendered only
             when the chronicle deposited a prefill; `--surface-raised` with the
             `--accent-subtle` left border (operator-authored content, §3.4). ── */}
      {steerSeed !== null && (
        <div
          style={{
            background: 'var(--surface-raised)',
            borderLeft: '3px solid var(--accent-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
          }}
        >
          <p style={{ margin: '0 0 4px', fontSize: 'var(--text-2xs)', color: 'var(--ink-muted)', fontFamily: 'var(--font-sans)' }}>
            Guidance for this run — sent with the launch prompt as an “Operator guidance” paragraph. Edit or clear it before sending.
          </p>
          <textarea
            data-testid="steer-prefill"
            className="w-full resize-none outline-none border-0 bg-transparent leading-5"
            style={{ color: 'var(--ink-high)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}
            value={launchSteer}
            onChange={(e) => setLaunchSteer(e.target.value)}
            rows={2}
          />
        </div>
      )}

      {/* ── Main input bubble ────────────────────────────────────────────── */}
      <div
        className="flex items-end gap-2 rounded-2xl px-4 py-3 transition-all"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
      >
        {/* + button with floating popover — both share the anchor ref */}
        <div className="relative shrink-0" ref={popoverAnchorRef}>
          {/* Floating popover, opens upward */}
          {popoverOpen && (
            <div
              style={{
                position: 'absolute',
                bottom: 'calc(100% + 10px)',
                left: 0,
                zIndex: 50,
              }}
            >
              <ContextPopover
                roster={roster}
                selectedClis={selectedClis}
                onToggleCli={toggleCli}
                confirmMode={confirmMode}
                onConfirmModeChange={setConfirmMode}
                beforeOrd={beforeOrd}
                onBeforeOrdChange={setBeforeOrd}
                entityMode={entityMode}
                onEntityModeChange={setEntityMode}
                workflows={selectableWorkflows}
                workflow={workflow}
                onWorkflowChange={(wf) => {
                  setWorkflow(wf);
                  setWorkflowDismissed(true);
                }}
                repos={repos}
                repoRefs={repoRefs}
                onRepoRefsChange={touchRepoRefs}
                attachedFiles={attachedFiles}
                onFilesChange={setAttachedFiles}
              />
            </div>
          )}

          {/* + trigger button */}
          <button
            type="button"
            aria-label="Open launch options"
            aria-expanded={popoverOpen}
            aria-haspopup="dialog"
            onClick={() => setPopoverOpen((v) => !v)}
            className="w-7 h-7 rounded-full flex items-center justify-center text-base font-light transition-all"
            style={
              popoverOpen
                ? {
                    background: 'var(--accent-subtle)',
                    color: 'var(--accent)',
                    border: '1px solid var(--accent-dim)',
                  }
                : {
                    background: 'var(--surface-raised)',
                    color: 'var(--ink-dim)',
                    border: '1px solid var(--surface-raised)',
                  }
            }
          >
            +
          </button>
        </div>

        {/* Problem textarea */}
        <textarea
          ref={textareaRef}
          data-testid="launch-problem"
          className="flex-1 resize-none text-base outline-none border-0 bg-transparent leading-6"
          style={{ minHeight: '28px', color: 'var(--ink-high)', fontFamily: 'inherit' }}
          placeholder="What do you need built?"
          value={problem}
          onChange={(e) => {
            setProblem(e.target.value);
            setWorkflowDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={submitting}
          rows={1}
        />

        {/* Send button */}
        <button
          type="button"
          data-testid="launch-submit"
          onClick={() => void submit()}
          disabled={!canSubmit}
          aria-label="Send"
          className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold font-mono disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {submitting ? `${elapsedSecs}s` : 'Send'}
        </button>
      </div>

      {/* Active option pills */}
      {activePills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {activePills.map((pill, i) => (
            <ActivePill key={i} label={pill.label} onClear={pill.onClear} {...(pill.attrs ? { attrs: pill.attrs } : {})} />
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p
          className="text-xs px-1 font-mono"
          style={{ color: 'var(--status-fail)' }}
          data-testid="launch-error"
        >
          {error}
        </p>
      )}

      {/* Planning latency hint */}
      {submitting && elapsedSecs >= 5 && (
        <p className="text-xs text-center font-mono" style={{ color: 'var(--ink-dim)' }}>
          Creating run… council distribution happens off-thread once launched.
        </p>
      )}
    </div>
  );
}
