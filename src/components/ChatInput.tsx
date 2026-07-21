import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { EntityMode, LaunchRunBody, RepoEntry, RosterSeat, WorkflowDef } from '../api/types.js';
import { useGateStore } from '../store/gates.js';
import { ContextPopover } from './ContextPopover.js';
import type { ConfirmMode } from './ContextPopover.js';

interface Props {
  /** If set, we're in "run selected" mode — steer if gated, otherwise placeholder. */
  runId?: string | null;
  /** The current status of the selected run. Used to decide steer vs disabled mode. */
  runStatus?: string | null;
  onLaunched: (runId: string) => void;
  /**
   * When true, renders inline (no footer border/background) so the widget can sit
   * centered in the empty-state layout rather than docked to the bottom of the pane.
   */
  embedded?: boolean;
  /** When set, forces this workflow id on every launch (overrides the popover selector). */
  workflowOverride?: string;
}

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
}: {
  label: string;
  onClear: () => void;
}): React.ReactElement {
  return (
    <span
      className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-mono"
      style={{
        background: 'rgba(230,237,243,0.07)',
        color: 'rgba(230,237,243,0.6)',
        border: '1px solid rgba(230,237,243,0.1)',
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

export function ChatInput({ runId, runStatus, onLaunched, embedded, workflowOverride }: Props): React.ReactElement {
  const clearGate = useGateStore((s) => s.clearGate);

  // ── Steer mode state ───────────────────────────────────────────────────────
  const [steerText, setSteerText] = useState('');
  const [steering, setSteering] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const steerRef = useRef<HTMLTextAreaElement>(null);

  // ── Launch form state ──────────────────────────────────────────────────────
  const [problem, setProblem] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selectedClis, setSelectedClis] = useState<Set<string>>(new Set());
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoRefs, setRepoRefs] = useState<string[]>([]);
  const [entityMode, setEntityMode] = useState<EntityMode>('shared');
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>('none');
  const [beforeOrd, setBeforeOrd] = useState(1);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

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
        setRoster(seats);
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
  }, []);

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
  useEffect(() => {
    if (!popoverOpen) return;
    function handleKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') setPopoverOpen(false);
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
  async function submit(): Promise<void> {
    if (!problem.trim() || selectedClis.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);

    // TODO: ingest attachedFiles via api.ingestKnowledge(title, chunks) before launching
    // (api.ingestKnowledge does not yet exist on the client surface)

    const body: LaunchRunBody = { problem: problem.trim() };
    const seats = roster.filter((s) => selectedClis.has(s.key));
    if (seats.length > 0) body.clisJson = JSON.stringify(seats);
    body.entityMode = entityMode;
    if (confirmMode === 'all') body.humanConfirm = 'all';
    else if (confirmMode === 'before') body.humanConfirm = `before:${beforeOrd}`;
    const firstRepo = repoRefs[0];
    if (firstRepo) body.repoRef = firstRepo;
    const wf = workflowOverride?.trim() || workflow;
    if (wf) body.workflow = wf;

    try {
      const { runId: newRunId } = await api.launchRun(body);
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

  // ══════════════════════════════════════════════════════════════════════════
  // Run-selected mode: steer at gates, placeholder otherwise
  // ══════════════════════════════════════════════════════════════════════════

  if (runId) {
    if (runStatus === 'awaiting_human') {
      const canSteer = steerText.trim().length > 0 && !steering;
      return (
        <div
          className="px-5 py-4 flex flex-col gap-2 shrink-0"
          style={{ borderTop: '1px solid rgba(230,237,243,0.07)', background: '#161c26' }}
        >
          {steerError && (
            <p className="text-[11px] font-mono" style={{ color: '#f85149' }}>
              {steerError}
            </p>
          )}
          <div
            className="flex items-end gap-3 rounded-2xl px-4 py-3"
            style={{ background: '#1b222e', border: '1px solid rgba(255,218,25,0.25)' }}
          >
            <textarea
              ref={steerRef}
              className="flex-1 resize-none text-base outline-none border-0 bg-transparent leading-6"
              style={{ minHeight: '28px', color: '#e6edf3', fontFamily: 'inherit' }}
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
              style={{ background: '#ffda19', color: '#0d1117' }}
            >
              {steering ? '…' : 'Steer →'}
            </button>
          </div>
          <p
            className="text-[10px] font-mono text-center"
            style={{ color: 'rgba(230,237,243,0.3)' }}
          >
            Approve + steer · Cmd+Enter · Use the gate panel above to approve/reject without steering
          </p>
        </div>
      );
    }

    // Actively executing — no mid-run injection
    return (
      <div
        className="px-5 py-4 shrink-0"
        style={{ borderTop: '1px solid rgba(230,237,243,0.07)', background: '#161c26' }}
      >
        <div
          className="rounded-2xl px-5 py-4"
          style={{ border: '1px solid rgba(230,237,243,0.1)', background: '#1b222e' }}
        >
          <p className="text-sm italic font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
            Run in progress — steer at the next gate.
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

  // Determine whether CLIs differ from the defaults that loaded from the roster
  const defaultCliSet = new Set(
    roster.filter((s) => s.enabled_for_council).map((s) => s.key),
  );
  const clisDirty =
    selectedClis.size !== defaultCliSet.size ||
    [...selectedClis].some((k) => !defaultCliSet.has(k));

  // Collect active non-default option pills
  const activePills: Array<{ label: string; onClear: () => void }> = [];

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
      label: `Repo: ${found?.name ?? rid}`,
      onClear: () => setRepoRefs((prev) => prev.filter((id) => id !== rid)),
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
              borderTop: '1px solid rgba(230,237,243,0.07)',
              background: '#161c26',
            }
      }
    >
      {/* Workflow detection hint */}
      {showDetection && (
        <div
          className="flex items-center gap-2 text-xs rounded-xl px-4 py-2 font-mono"
          style={{
            background: '#161c26',
            border: '1px solid rgba(230,237,243,0.1)',
            color: 'rgba(230,237,243,0.7)',
          }}
        >
          <span>
            Detected: <strong style={{ color: '#ffda19' }}>{detectedWorkflow}</strong> workflow
          </span>
          <button
            type="button"
            onClick={() => {
              setWorkflow(detectedWorkflow!);
              setWorkflowDismissed(true);
            }}
            className="rounded-lg px-3 py-1 font-semibold text-xs"
            style={{ background: '#ffda19', color: '#0d1117' }}
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setWorkflowDismissed(true)}
            className="ml-auto"
            style={{ color: 'rgba(230,237,243,0.35)' }}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Main input bubble ────────────────────────────────────────────── */}
      <div
        className="flex items-end gap-2 rounded-2xl px-4 py-3 transition-all"
        style={{ background: '#1b222e', border: '1px solid rgba(230,237,243,0.14)' }}
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
                workflows={workflows}
                workflow={workflow}
                onWorkflowChange={(wf) => {
                  setWorkflow(wf);
                  setWorkflowDismissed(true);
                }}
                repos={repos}
                repoRefs={repoRefs}
                onRepoRefsChange={setRepoRefs}
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
                    background: 'rgba(255,218,25,0.15)',
                    color: '#ffda19',
                    border: '1px solid rgba(255,218,25,0.3)',
                  }
                : {
                    background: 'rgba(230,237,243,0.06)',
                    color: 'rgba(230,237,243,0.4)',
                    border: '1px solid rgba(230,237,243,0.08)',
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
          style={{ minHeight: '28px', color: '#e6edf3', fontFamily: 'inherit' }}
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
          style={{ background: '#ffda19', color: '#0d1117' }}
        >
          {submitting ? `${elapsedSecs}s` : 'Send'}
        </button>
      </div>

      {/* Active option pills */}
      {activePills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {activePills.map((pill, i) => (
            <ActivePill key={i} label={pill.label} onClear={pill.onClear} />
          ))}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p
          className="text-xs px-1 font-mono"
          style={{ color: '#f85149' }}
          data-testid="launch-error"
        >
          {error}
        </p>
      )}

      {/* Planning latency hint */}
      {submitting && elapsedSecs >= 5 && (
        <p className="text-xs text-center font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
          Planning in progress — council routing + plan decomposition takes 30–60 s. Don't re-submit.
        </p>
      )}
    </div>
  );
}
