import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { EntityMode, LaunchRunBody, RepoEntry, RosterSeat, WorkflowDef } from '../api/types.js';

interface Props {
  /** If set, we're in "run selected" mode — show disabled placeholder. */
  runId?: string | null;
  onLaunched: (runId: string) => void;
}

type ConfirmMode = 'none' | 'all' | 'before';

const WORKFLOW_LABELS: Record<string, string> = {
  feature: 'Feature (6 phases)',
  bug: 'Bug (4 phases)',
  migration: 'Migration (5 phases)',
};

function detectWorkflow(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)) return 'bug';
  if (/\b(feature|implement|add|create)\b/.test(lower) && !/\b(bug|fix|broken|error|crash|issue)\b/.test(lower)) return 'feature';
  if (/\b(migrate|upgrade|migration|move)\b/.test(lower)) return 'migration';
  return null;
}

export function ChatInput({ runId, onLaunched }: Props): React.ReactElement {
  const [problem, setProblem] = useState('');
  const [workflow, setWorkflow] = useState('');
  const [roster, setRoster] = useState<RosterSeat[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selectedClis, setSelectedClis] = useState<Set<string>>(new Set());
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoRef, setRepoRef] = useState('');
  const [entityMode, setEntityMode] = useState<EntityMode>('shared');
  const [confirmMode, setConfirmMode] = useState<ConfirmMode>('none');
  const [beforeOrd, setBeforeOrd] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSecs, setElapsedSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [detectedWorkflow, setDetectedWorkflow] = useState<string | null>(null);
  const [workflowDismissed, setWorkflowDismissed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api
      .getRoster()
      .then(({ roster: seats }) => {
        setRoster(seats);
        setSelectedClis(new Set(seats.filter((s) => s.enabled_for_council).map((s) => s.key)));
      })
      .catch(() => {/* roster load failure is non-fatal */});
    api.listRepos().then(({ repos: rs }) => setRepos(rs)).catch(() => {});
    api.listWorkflows().then(({ workflows: wfs }) => setWorkflows(wfs)).catch(() => {});
  }, []);

  useEffect(() => {
    if (submitting) {
      setElapsedSecs(0);
      timerRef.current = setInterval(() => setElapsedSecs((s) => s + 1), 1000);
    } else {
      if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; }
      setElapsedSecs(0);
    }
    return () => { if (timerRef.current !== null) { clearInterval(timerRef.current); timerRef.current = null; } };
  }, [submitting]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 5;
    ta.style.height = `${Math.min(ta.scrollHeight, maxHeight)}px`;
  }, [problem]);

  // Signal detection
  useEffect(() => {
    if (!problem.trim() || workflow) {
      setDetectedWorkflow(null);
      return;
    }
    setDetectedWorkflow(detectWorkflow(problem));
  }, [problem, workflow]);

  function toggleCli(key: string): void {
    setSelectedClis((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function workflowLabel(id: string): string {
    const wf = workflows.find((w) => w.id === id);
    if (wf) {
      return `${id.charAt(0).toUpperCase() + id.slice(1)} (${wf.phases.length} phases: ${wf.phases.map((p) => p.id).join(' → ')})`;
    }
    return WORKFLOW_LABELS[id] ?? id;
  }

  async function submit(): Promise<void> {
    if (!problem.trim() || selectedClis.size === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    const body: LaunchRunBody = { problem: problem.trim() };
    const seats = roster.filter((s) => selectedClis.has(s.key));
    if (seats.length > 0) body.clisJson = JSON.stringify(seats);
    body.entityMode = entityMode;
    if (confirmMode === 'all') body.humanConfirm = 'all';
    else if (confirmMode === 'before') body.humanConfirm = `before:${beforeOrd}`;
    if (repoRef) body.repoRef = repoRef;
    if (workflow) body.workflow = workflow;
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

  // Run-selected mode: just a disabled placeholder
  if (runId) {
    return (
      <div className="px-5 py-4 border-t border-gray-100 bg-white">
        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4">
          <p className="text-sm text-gray-400 italic">Run in progress — responses stream above.</p>
        </div>
      </div>
    );
  }

  const canSubmit = problem.trim().length > 0 && selectedClis.size > 0 && !submitting;
  const showDetection = detectedWorkflow !== null && !workflowDismissed && !workflow;

  return (
    <div className="px-5 py-4 border-t border-gray-100 bg-white flex flex-col gap-3">
      {showDetection && (
        <div className="flex items-center gap-2 text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2">
          <span>Detected: <strong>{detectedWorkflow}</strong> workflow</span>
          <button
            type="button"
            onClick={() => { setWorkflow(detectedWorkflow!); setWorkflowDismissed(true); }}
            className="rounded-lg bg-emerald-600 text-white px-3 py-1 hover:bg-emerald-700 font-semibold text-xs"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setWorkflowDismissed(true)}
            className="text-zinc-400 hover:text-zinc-600 ml-auto"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main input row */}
      <div className="flex items-end gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 transition-all">
        <textarea
          ref={textareaRef}
          data-testid="launch-problem"
          className="flex-1 resize-none text-base outline-none border-0 bg-transparent leading-6 placeholder:text-gray-400 text-gray-900"
          style={{ minHeight: '28px' }}
          placeholder="What do you need built?"
          value={problem}
          onChange={(e) => { setProblem(e.target.value); setWorkflowDismissed(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={submitting}
          rows={1}
        />
        <button
          type="button"
          data-testid="launch-submit"
          onClick={() => void submit()}
          disabled={!canSubmit}
          aria-label="Send"
          className="shrink-0 rounded-xl bg-emerald-600 px-5 py-2.5 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? `${elapsedSecs}s` : 'Send'}
        </button>
      </div>

      {/* Agent checkboxes + options row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        {/* CLI checkboxes */}
        {roster.map((seat) => (
          <label key={seat.key} className="flex items-center gap-1.5 cursor-pointer hover:text-gray-700">
            <input
              type="checkbox"
              className="rounded"
              checked={selectedClis.has(seat.key)}
              onChange={() => toggleCli(seat.key)}
              data-testid={`launch-seat-${seat.key}`}
            />
            <span className="font-mono">{seat.key}</span>
          </label>
        ))}

        <span className="text-gray-200">|</span>

        {/* Gate dropdown */}
        <div className="flex items-center gap-1.5">
          <span>Gate:</span>
          <select
            data-testid="launch-confirm"
            className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 bg-white"
            value={confirmMode}
            onChange={(e) => setConfirmMode(e.target.value as ConfirmMode)}
          >
            <option value="none">None</option>
            <option value="all">Every unit</option>
            <option value="before">Before unit #</option>
          </select>
          {confirmMode === 'before' && (
            <input
              type="number"
              min={1}
              value={beforeOrd}
              onChange={(e) => setBeforeOrd(Math.max(1, Number(e.target.value) || 1))}
              className="w-14 rounded-lg border border-gray-200 px-2 py-1 text-xs"
            />
          )}
        </div>

        <span className="text-gray-200">|</span>

        {/* Entity mode toggle */}
        <div className="flex items-center gap-1.5">
          <span>Mode:</span>
          {(['shared', 'isolated'] as EntityMode[]).map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`launch-entity-${m}`}
              onClick={() => setEntityMode(m)}
              className={`rounded-lg px-2.5 py-1 capitalize text-xs font-medium transition-colors ${
                entityMode === m
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <span className="text-gray-200">|</span>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          {showAdvanced ? '▾ Advanced' : '▸ Advanced'}
        </button>
      </div>

      {/* Advanced: workflow + repo selectors */}
      {showAdvanced && (
        <div className="flex flex-wrap gap-4 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-medium">Workflow:</span>
            <select
              data-testid="launch-workflow"
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-700"
              value={workflow}
              onChange={(e) => { setWorkflow(e.target.value); setWorkflowDismissed(true); }}
            >
              <option value="">(free-text)</option>
              {(workflows.length > 0 ? workflows.map((w) => w.id) : Object.keys(WORKFLOW_LABELS)).map((id) => (
                <option key={id} value={id}>{workflowLabel(id)}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 font-medium">Repo:</span>
            <select
              data-testid="launch-repo"
              className="rounded-lg border border-gray-200 px-2 py-1 text-xs bg-white text-gray-700"
              value={repoRef}
              onChange={(e) => setRepoRef(e.target.value)}
            >
              <option value="">(none)</option>
              {repos.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-600 px-1" data-testid="launch-error">{error}</p>
      )}

      {submitting && elapsedSecs >= 5 && (
        <p className="text-xs text-gray-400 text-center">
          Planning in progress — council routing + plan decomposition takes 30–60 s. Don't re-submit.
        </p>
      )}
    </div>
  );
}
