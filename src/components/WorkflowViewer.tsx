import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { GateSpec, PhaseDef, PhaseExecutor, WorkflowDef } from '../api/types.js';
import { setCachedWorkflows } from '../store/workflowCache.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function gateLabel(gate: GateSpec): string {
  if (gate === 'auto') return 'Auto';
  if (gate && typeof gate === 'object' && 'human_confirm' in gate) {
    return gate.human_confirm.unconditional ? 'Human (always)' : 'Human';
  }
  return 'Human if not PASS';
}

const KIND_DOT_COLOR: Record<string, string> = {
  recon: 'var(--accent)',
  build: 'var(--status-run)',
  review: 'var(--accent-dim)',
  test: 'var(--status-gate)',
};

function kindDotColor(kind: PhaseDef['kind']): string {
  return KIND_DOT_COLOR[kind] ?? 'var(--ink-dim)';
}

// ── Viewer-only phase card ─────────────────────────────────────────────────────

function PhaseCard({ phase }: { phase: PhaseDef }): React.ReactElement {
  const ex = phase.executor;
  const dotColor = kindDotColor(phase.kind);
  return (
    <div
      className="rounded px-3 py-2 text-[11px] flex flex-col gap-1"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor }} title={phase.kind} />
        <span className="font-semibold" style={{ color: 'var(--ink-high)' }}>{phase.id}</span>
        <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{phase.kind}</span>
        {phase.role !== 'neutral' && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
            style={{
              background: 'var(--accent-subtle)',
              color: phase.role === 'creator' ? 'var(--accent)' : 'var(--accent-dim)',
            }}
          >
            {phase.role}
          </span>
        )}
        {ex && ex.type === 'tool' && (
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
            style={{ background: 'var(--status-gate-dim)', color: 'var(--status-gate)' }}
          >
            tool: {ex.cmd.join(' ')}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        <span>
          <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>gate:</span>{' '}
          {phase.gate_type ? `${phase.gate_type} / ` : ''}{gateLabel(phase.gate)}
        </span>
        {phase.depends_on.length > 0 && (
          <span>
            <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>after:</span>{' '}
            {phase.depends_on.join(', ')}
          </span>
        )}
        {phase.skill_ref && (
          <span>
            <span className="font-medium" style={{ color: 'var(--ink-muted)' }}>skill:</span>{' '}
            <span className="font-mono">{phase.skill_ref}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Builder types ──────────────────────────────────────────────────────────────

type ExecMode = 'agent' | 'command' | 'script';
type GateMode = 'auto' | 'human' | 'human_if';
type ScriptLang = 'bash' | 'python' | 'sh';

interface BuilderPhase {
  _key: string;
  id: string;
  kind: 'recon' | 'build' | 'review' | 'test';
  execMode: ExecMode;
  cmd: string;
  script: string;
  scriptLang: ScriptLang;
  scriptPath: string;
  gate: GateMode;
  role: 'neutral' | 'creator' | 'evaluator';
  dependsOn: string[];
  executesCode: boolean;
  verifiedEvidence: boolean;
}

function emptyPhase(): BuilderPhase {
  return {
    _key: Math.random().toString(36).slice(2),
    id: '',
    kind: 'build',
    execMode: 'agent',
    cmd: '',
    script: '',
    scriptLang: 'bash',
    scriptPath: '',
    gate: 'auto',
    role: 'neutral',
    dependsOn: [],
    executesCode: false,
    verifiedEvidence: false,
  };
}

function toGateSpec(gate: GateMode): GateSpec {
  if (gate === 'human') return { human_confirm: { unconditional: false } };
  if (gate === 'human_if') return { human_confirm_if: 'verdict_not_pass' };
  return 'auto';
}

async function resolveExecutor(p: BuilderPhase): Promise<PhaseExecutor> {
  if (p.execMode === 'agent') return { type: 'agent' };
  if (p.execMode === 'command') {
    const cmd = p.cmd.trim().split(/\s+/).filter(Boolean);
    return { type: 'tool', cmd };
  }
  const scriptName = p.id.trim() || `script-${p._key}`;
  const { path } = await api.saveScript(scriptName, p.script, p.scriptLang);
  const interp = p.scriptLang === 'python' ? 'python3' : p.scriptLang === 'sh' ? 'sh' : 'bash';
  return { type: 'tool', cmd: [interp, path] };
}

async function buildDef(id: string, phases: BuilderPhase[]): Promise<WorkflowDef> {
  const resolvedPhases: PhaseDef[] = await Promise.all(
    phases.map(async (p, i): Promise<PhaseDef> => ({
      id: p.id || `phase-${i + 1}`,
      kind: p.kind,
      gate_type: p.gate === 'auto' ? null : 'execution',
      gate: toGateSpec(p.gate),
      executes_code: p.executesCode,
      verified_evidence: p.verifiedEvidence,
      required_deliverables: [],
      depends_on: p.dependsOn,
      role: p.role,
      skill_ref: null,
      allowed_skills: [],
      validator_pin: null,
      executor: await resolveExecutor(p),
    })),
  );
  return { id, phases: resolvedPhases };
}

// ── Phase editor ───────────────────────────────────────────────────────────────

const inputStyle = { background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' };

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors"
      style={active
        ? { background: 'var(--surface-card)', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }
        : { background: 'transparent', color: 'var(--ink-dim)', border: '1px solid transparent' }
      }
    >
      {children}
    </button>
  );
}

function PhaseEditor({
  phase,
  index,
  total,
  allIds,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  phase: BuilderPhase;
  index: number;
  total: number;
  allIds: string[];
  onChange: (p: BuilderPhase) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.ReactElement {
  const up = <T,>(field: keyof BuilderPhase, val: T) => onChange({ ...phase, [field]: val } as BuilderPhase);
  const prior = allIds.slice(0, index);

  return (
    <div
      className="rounded p-3 flex flex-col gap-2"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kindDotColor(phase.kind) }} />
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Phase {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="px-1 text-[10px] disabled:opacity-30"
            style={{ color: 'var(--ink-dim)' }}
          >▲</button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="px-1 text-[10px] disabled:opacity-30"
            style={{ color: 'var(--ink-dim)' }}
          >▼</button>
          <button
            type="button"
            onClick={onRemove}
            className="px-1 text-[10px]"
            style={{ color: 'var(--status-fail)' }}
          >✕</button>
        </div>
      </div>

      {/* id + kind */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded px-2 py-1 text-xs focus:outline-none"
          placeholder="phase-id (e.g. build)"
          value={phase.id}
          onChange={(e) => up('id', e.target.value)}
          style={inputStyle}
        />
        <select
          className="rounded px-2 py-1 text-xs focus:outline-none"
          value={phase.kind}
          onChange={(e) => up('kind', e.target.value as BuilderPhase['kind'])}
          style={inputStyle}
        >
          {(['recon', 'build', 'review', 'test'] as const).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {/* executor */}
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1">
          {(['agent', 'command', 'script'] as ExecMode[]).map((m) => (
            <ToggleBtn key={m} active={phase.execMode === m} onClick={() => up('execMode', m)}>
              {m === 'agent' ? 'Agent' : m === 'command' ? 'Command' : 'Script'}
            </ToggleBtn>
          ))}
        </div>

        {phase.execMode === 'command' && (
          <input
            className="rounded px-2 py-1 text-xs font-mono focus:outline-none"
            placeholder="e.g. wicked-estate index  or  npm run build"
            value={phase.cmd}
            onChange={(e) => up('cmd', e.target.value)}
            style={inputStyle}
          />
        )}

        {phase.execMode === 'script' && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1 items-center">
              <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Language:</span>
              {(['bash', 'sh', 'python'] as ScriptLang[]).map((l) => (
                <ToggleBtn key={l} active={phase.scriptLang === l} onClick={() => up('scriptLang', l)}>
                  {l}
                </ToggleBtn>
              ))}
            </div>
            <textarea
              className="rounded px-2 py-1.5 text-xs font-mono resize-y focus:outline-none"
              rows={6}
              placeholder={phase.scriptLang === 'python' ? '# python script\nprint("hello")' : '# bash script\necho "hello"'}
              value={phase.script}
              onChange={(e) => up('script', e.target.value)}
              style={{ ...inputStyle, background: 'var(--surface-base)' }}
            />
            <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
              Saved to{' '}
              <span style={{ color: 'var(--ink-muted)' }}>
                ~/.wicked/scripts/{phase.id || 'script'}.{phase.scriptLang === 'python' ? 'py' : 'sh'}
              </span>
            </p>
          </div>
        )}
      </div>

      {/* gate + role */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Gate</span>
          <div className="flex gap-1">
            {([['auto', 'Auto'], ['human', 'Human'], ['human_if', 'Human if fails']] as [GateMode, string][]).map(([v, label]) => (
              <ToggleBtn key={v} active={phase.gate === v} onClick={() => up('gate', v)}>
                {label}
              </ToggleBtn>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Role</span>
          <div className="flex gap-1">
            {(['neutral', 'creator', 'evaluator'] as const).map((r) => (
              <ToggleBtn key={r} active={phase.role === r} onClick={() => up('role', r)}>
                {r}
              </ToggleBtn>
            ))}
          </div>
        </div>
      </div>

      {/* depends on */}
      {prior.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Depends on</span>
          <div className="flex flex-wrap gap-1.5">
            {prior.map((pid) => (
              <label key={pid} className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
                <input
                  type="checkbox"
                  checked={phase.dependsOn.includes(pid)}
                  onChange={(e) =>
                    up('dependsOn', e.target.checked
                      ? [...phase.dependsOn, pid]
                      : phase.dependsOn.filter((d) => d !== pid))
                  }
                />
                <span className="font-mono">{pid}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* flags */}
      <div className="flex gap-3 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={phase.executesCode} onChange={(e) => up('executesCode', e.target.checked)} />
          executes code
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={phase.verifiedEvidence} onChange={(e) => up('verifiedEvidence', e.target.checked)} />
          verified evidence
        </label>
      </div>
    </div>
  );
}

// ── Workflow builder ───────────────────────────────────────────────────────────

function WorkflowBuilder({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: WorkflowDef;
  onSaved: (wf: WorkflowDef) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [workflowId, setWorkflowId] = useState(initial?.id ?? '');
  const [phases, setPhases] = useState<BuilderPhase[]>(() => {
    if (!initial) return [emptyPhase()];
    return initial.phases.map((p) => {
      const ex = p.executor;
      const execMode: ExecMode = ex?.type === 'tool' ? 'command' : 'agent';
      return {
        _key: Math.random().toString(36).slice(2),
        id: p.id,
        kind: p.kind,
        execMode,
        cmd: ex?.type === 'tool' ? ex.cmd.join(' ') : '',
        script: '',
        scriptLang: 'bash',
        scriptPath: '',
        gate: p.gate === 'auto' ? 'auto' : (typeof p.gate === 'object' && p.gate !== null && 'human_confirm_if' in p.gate) ? 'human_if' : 'human',
        role: p.role,
        dependsOn: p.depends_on,
        executesCode: p.executes_code,
        verifiedEvidence: p.verified_evidence,
      };
    });
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [previewJson, setPreviewJson] = useState('');

  const allIds = phases.map((p) => p.id).filter(Boolean);

  function updatePhase(i: number, p: BuilderPhase) {
    setPhases((prev) => prev.map((x, j) => (j === i ? p : x)));
  }
  function removePhase(i: number) { setPhases((prev) => prev.filter((_, j) => j !== i)); }
  function addPhase() { setPhases((prev) => [...prev, emptyPhase()]); }
  function moveUp(i: number) {
    if (i === 0) return;
    setPhases((prev) => { const a = [...prev]; [a[i - 1], a[i]] = [a[i]!, a[i - 1]!]; return a; });
  }
  function moveDown(i: number) {
    setPhases((prev) => {
      if (i >= prev.length - 1) return prev;
      const a = [...prev]; [a[i], a[i + 1]] = [a[i + 1]!, a[i]!]; return a;
    });
  }

  async function handlePreview() {
    try {
      const def = await buildDef(workflowId, phases);
      setPreviewJson(JSON.stringify(def, null, 2));
      setShowJson(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function handleSave() {
    if (!workflowId.trim()) { setError('Workflow ID is required'); return; }
    if (phases.length === 0) { setError('At least one phase is required'); return; }
    setSaving(true);
    setError(null);
    try {
      const def = await buildDef(workflowId.trim(), phases);
      await api.createWorkflow(def);
      onSaved(def);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const def = JSON.parse(ev.target?.result as string) as WorkflowDef;
        setWorkflowId(def.id ?? '');
        setPhases(def.phases.map((p) => {
          const ex = p.executor;
          return {
            _key: Math.random().toString(36).slice(2),
            id: p.id,
            kind: p.kind,
            execMode: ex?.type === 'tool' ? 'command' : 'agent' as ExecMode,
            cmd: ex?.type === 'tool' ? ex.cmd.join(' ') : '',
            script: '', scriptLang: 'bash', scriptPath: '',
            gate: p.gate === 'auto' ? 'auto' : (typeof p.gate === 'object' && p.gate !== null && 'human_confirm_if' in p.gate) ? 'human_if' : 'human',
            role: p.role, dependsOn: p.depends_on,
            executesCode: p.executes_code, verifiedEvidence: p.verified_evidence,
          };
        }));
        setError(null);
      } catch { setError('Could not parse workflow JSON'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="flex-1 rounded px-2 py-1 text-xs font-semibold focus:outline-none"
          placeholder="workflow-id (e.g. my-deploy)"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          style={inputStyle}
        />
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleUpload} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded px-2 py-1 text-[11px]"
          style={{ border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          Upload JSON
        </button>
        <button
          type="button"
          onClick={() => void handlePreview()}
          className="rounded px-2 py-1 text-[11px]"
          style={{ border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          Preview JSON
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-[11px] px-1 hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Cancel
        </button>
      </div>

      {/* json preview */}
      {showJson && (
        <div className="relative">
          <pre
            className="rounded text-[10px] p-3 overflow-auto max-h-48 font-mono"
            style={{ background: 'var(--surface-base)', color: 'var(--status-run)' }}
          >
            {previewJson}
          </pre>
          <button
            type="button"
            onClick={() => setShowJson(false)}
            className="absolute top-1 right-1 text-[10px]"
            style={{ color: 'var(--ink-dim)' }}
          >✕</button>
        </div>
      )}

      {/* phases */}
      <div className="flex flex-col gap-2">
        {phases.map((p, i) => (
          <PhaseEditor
            key={p._key}
            phase={p}
            index={i}
            total={phases.length}
            allIds={allIds}
            onChange={(updated) => updatePhase(i, updated)}
            onRemove={() => removePhase(i)}
            onMoveUp={() => moveUp(i)}
            onMoveDown={() => moveDown(i)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={addPhase}
        className="self-start rounded px-3 py-1 text-[11px] transition-colors"
        style={{ border: '1px dashed var(--surface-raised)', color: 'var(--ink-muted)' }}
      >
        + Add phase
      </button>

      {error && <p className="text-[11px]" style={{ color: 'var(--status-fail)' }}>{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className="self-start rounded px-4 py-1.5 text-[11px] font-semibold disabled:opacity-50"
        style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
      >
        {saving ? 'Saving…' : 'Save workflow'}
      </button>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function WorkflowViewer(): React.ReactElement {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [editTarget, setEditTarget] = useState<WorkflowDef | undefined>(undefined);

  // Use a ref so `load` doesn't capture `selected` as a dep — that would recreate
  // `load` on every selection change, causing the useEffect to re-fetch on every click.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { workflows: wfs } = await api.listWorkflows();
      // Deposit for the app (studio#122 D-1): this surface RE-loads after every
      // create/delete, so the shared `is_system` cache the delivery surfaces
      // read stays current with the edits made here — and costs no extra GET.
      setCachedWorkflows(wfs);
      setWorkflows(wfs);
      if (wfs.length > 0 && !selectedRef.current) setSelected(wfs[0]?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function openBuilder(edit?: WorkflowDef) {
    setEditTarget(edit);
    setBuilding(true);
  }

  function onSaved(wf: WorkflowDef) {
    setWorkflows((prev) => {
      const exists = prev.findIndex((w) => w.id === wf.id);
      return exists >= 0 ? prev.map((w) => (w.id === wf.id ? wf : w)) : [...prev, wf];
    });
    setSelected(wf.id);
    setBuilding(false);
  }

  const current = workflows.find((w) => w.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex-1" style={{ color: 'var(--ink-high)' }}>Workflows</h2>
        {!building && (
          <>
            <button
              type="button"
              onClick={() => openBuilder()}
              className="rounded px-3 py-1 text-[11px] font-semibold"
              style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
            >
              New workflow
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="text-[10px] hover:underline"
              style={{ color: 'var(--ink-dim)' }}
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {loading && <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading workflows…</p>}
      {error && (
        <p className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {error}
        </p>
      )}

      <div className="flex gap-4">
        {/* left: workflow list */}
        {!building && (
          <div className="flex flex-col gap-1.5 w-40 shrink-0">
            {workflows.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelected(w.id)}
                className="w-full text-left rounded px-3 py-2 text-[11px] transition-colors"
                style={w.id === selected
                  ? { border: '1px solid var(--accent-dim)', background: 'var(--accent-subtle)', color: 'var(--accent)' }
                  : { border: '1px solid var(--surface-raised)', background: 'var(--surface-card)', color: 'var(--ink-muted)' }
                }
              >
                <div className="font-semibold">{w.id}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{w.phases.length} phases</div>
              </button>
            ))}
          </div>
        )}

        {/* right: builder or viewer */}
        <div className="flex-1 min-w-0">
          {building ? (
            <WorkflowBuilder
              {...(editTarget !== undefined ? { initial: editTarget } : {})}
              onSaved={onSaved}
              onCancel={() => setBuilding(false)}
            />
          ) : current ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider font-mono" style={{ color: 'var(--ink-dim)' }}>
                  {current.id}
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
                  — {current.phases.length} phases
                </span>
                <button
                  type="button"
                  onClick={() => openBuilder(current)}
                  className="ml-auto text-[10px] hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => openBuilder({ ...current, id: `${current.id}-copy` })}
                  className="text-[10px] hover:underline"
                  style={{ color: 'var(--ink-dim)' }}
                >
                  Duplicate
                </button>
              </div>
              {current.phases.map((p) => <PhaseCard key={p.id} phase={p} />)}
            </div>
          ) : null}
        </div>
      </div>

      {!building && (
        <p className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
          Workflows saved to <span style={{ color: 'var(--ink-dim)' }}>~/.wicked/workflows/</span> and registered immediately.
          Scripts saved to <span style={{ color: 'var(--ink-dim)' }}>~/.wicked/scripts/</span>.
        </p>
      )}
    </div>
  );
}
