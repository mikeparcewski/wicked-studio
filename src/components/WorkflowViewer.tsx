import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { GateSpec, PhaseDef, PhaseExecutor, WorkflowDef } from '../api/types.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function gateLabel(gate: GateSpec): string {
  if (gate === 'auto') return 'Auto';
  if (gate && typeof gate === 'object' && 'human_confirm' in gate) {
    return gate.human_confirm.unconditional ? 'Human (always)' : 'Human';
  }
  return 'Human if not PASS';
}

function kindDot(kind: PhaseDef['kind']): string {
  const c: Record<string, string> = { recon: 'bg-gray-400', build: 'bg-blue-500', review: 'bg-purple-500', test: 'bg-green-500' };
  return c[kind] ?? 'bg-gray-300';
}

// ── Viewer-only phase card ─────────────────────────────────────────────────────

function PhaseCard({ phase }: { phase: PhaseDef }): React.ReactElement {
  const ex = phase.executor;
  return (
    <div className="rounded border border-gray-200 bg-white px-3 py-2 text-[11px] flex flex-col gap-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`h-2 w-2 rounded-full shrink-0 ${kindDot(phase.kind)}`} title={phase.kind} />
        <span className="font-semibold text-gray-800">{phase.id}</span>
        <span className="text-gray-400 text-[10px]">{phase.kind}</span>
        {phase.role !== 'neutral' && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${phase.role === 'creator' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
            {phase.role}
          </span>
        )}
        {ex && ex.type === 'tool' && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 font-mono">
            tool: {ex.cmd.join(' ')}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500">
        <span><span className="font-medium text-gray-600">gate:</span> {phase.gate_type ? `${phase.gate_type} / ` : ''}{gateLabel(phase.gate)}</span>
        {phase.depends_on.length > 0 && <span><span className="font-medium text-gray-600">after:</span> {phase.depends_on.join(', ')}</span>}
        {phase.skill_ref && <span><span className="font-medium text-gray-600">skill:</span> <span className="font-mono">{phase.skill_ref}</span></span>}
      </div>
    </div>
  );
}

// ── Builder types ──────────────────────────────────────────────────────────────

type ExecMode = 'agent' | 'command' | 'script';
type GateMode = 'auto' | 'human' | 'human_if';
type ScriptLang = 'bash' | 'python' | 'sh';

interface BuilderPhase {
  _key: string; // internal stable key for React lists
  id: string;
  kind: 'recon' | 'build' | 'review' | 'test';
  execMode: ExecMode;
  cmd: string;         // space-separated argv for 'command' mode
  script: string;      // inline content for 'script' mode
  scriptLang: ScriptLang;
  scriptPath: string;  // resolved path after saving (populated on save)
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
  // script mode — save and get path; use _key as unique fallback when id is blank
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
    <div className="rounded border border-gray-200 bg-white p-3 flex flex-col gap-2">
      {/* header */}
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${kindDot(phase.kind)}`} />
        <span className="text-[11px] font-semibold text-gray-700">Phase {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={onMoveUp} disabled={index === 0} className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 text-[10px]">▲</button>
          <button type="button" onClick={onMoveDown} disabled={index === total - 1} className="px-1 text-gray-400 hover:text-gray-700 disabled:opacity-30 text-[10px]">▼</button>
          <button type="button" onClick={onRemove} className="px-1 text-red-400 hover:text-red-600 text-[10px]">✕</button>
        </div>
      </div>

      {/* id + kind */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs"
          placeholder="phase-id (e.g. build)"
          value={phase.id}
          onChange={(e) => up('id', e.target.value)}
        />
        <select
          className="rounded border border-gray-300 px-2 py-1 text-xs"
          value={phase.kind}
          onChange={(e) => up('kind', e.target.value as BuilderPhase['kind'])}
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
            <button
              key={m}
              type="button"
              onClick={() => up('execMode', m)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                phase.execMode === m ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
              }`}
            >
              {m === 'agent' ? 'Agent' : m === 'command' ? 'Command' : 'Script'}
            </button>
          ))}
        </div>

        {phase.execMode === 'command' && (
          <input
            className="rounded border border-gray-300 px-2 py-1 text-xs font-mono"
            placeholder="e.g. wicked-estate index  or  npm run build"
            value={phase.cmd}
            onChange={(e) => up('cmd', e.target.value)}
          />
        )}

        {phase.execMode === 'script' && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1 items-center">
              <span className="text-[10px] text-gray-500">Language:</span>
              {(['bash', 'sh', 'python'] as ScriptLang[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => up('scriptLang', l)}
                  className={`rounded px-2 py-0.5 text-[10px] font-mono ${
                    phase.scriptLang === l ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <textarea
              className="rounded border border-gray-300 px-2 py-1.5 text-xs font-mono resize-y"
              rows={6}
              placeholder={phase.scriptLang === 'python' ? '# python script\nprint("hello")' : '# bash script\necho "hello"'}
              value={phase.script}
              onChange={(e) => up('script', e.target.value)}
            />
            <p className="text-[10px] text-zinc-400">
              Saved to <span className="font-mono">~/.wicked/scripts/{phase.id || 'script'}.{phase.scriptLang === 'python' ? 'py' : 'sh'}</span>
            </p>
          </div>
        )}
      </div>

      {/* gate + role */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">Gate</span>
          <div className="flex gap-1">
            {([['auto', 'Auto'], ['human', 'Human'], ['human_if', 'Human if fails']] as [GateMode, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => up('gate', v)}
                className={`rounded px-2 py-0.5 text-[10px] ${phase.gate === v ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">Role</span>
          <div className="flex gap-1">
            {(['neutral', 'creator', 'evaluator'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => up('role', r)}
                className={`rounded px-2 py-0.5 text-[10px] capitalize ${phase.role === r ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-100'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* depends on */}
      {prior.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">Depends on</span>
          <div className="flex flex-wrap gap-1.5">
            {prior.map((pid) => (
              <label key={pid} className="flex items-center gap-1 text-[10px] text-gray-600 cursor-pointer">
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
      <div className="flex gap-3 text-[10px] text-gray-500">
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
        gate: p.gate === 'auto' ? 'auto' : 'human_confirm_if' in (p.gate ?? {}) ? 'human_if' : 'human',
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

  // Upload handler
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
            gate: p.gate === 'auto' ? 'auto' : 'human_confirm_if' in (p.gate ?? {}) ? 'human_if' : 'human',
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
          className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-semibold"
          placeholder="workflow-id (e.g. my-deploy)"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        />
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleUpload} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
        >
          Upload JSON
        </button>
        <button
          type="button"
          onClick={() => void handlePreview()}
          className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-50"
        >
          Preview JSON
        </button>
        <button type="button" onClick={onCancel} className="text-[11px] text-gray-400 hover:text-gray-700 px-1">
          Cancel
        </button>
      </div>

      {/* json preview */}
      {showJson && (
        <div className="relative">
          <pre className="rounded bg-gray-900 text-green-300 text-[10px] p-3 overflow-auto max-h-48 font-mono">
            {previewJson}
          </pre>
          <button
            type="button"
            onClick={() => setShowJson(false)}
            className="absolute top-1 right-1 text-[10px] text-gray-400 hover:text-white"
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
        className="self-start rounded border border-dashed border-gray-300 px-3 py-1 text-[11px] text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        + Add phase
      </button>

      {error && <p className="text-[11px] text-red-600">{error}</p>}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving}
        className="self-start rounded bg-emerald-600 px-4 py-1.5 text-[11px] text-white hover:bg-emerald-700 disabled:opacity-50"
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { workflows: wfs } = await api.listWorkflows();
      setWorkflows(wfs);
      if (wfs.length > 0 && !selected) setSelected(wfs[0]?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [selected]);

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
        <h2 className="text-sm font-semibold text-gray-800 flex-1">Workflows</h2>
        {!building && (
          <>
            <button
              type="button"
              onClick={() => openBuilder()}
              className="rounded bg-emerald-600 px-3 py-1 text-[11px] text-white hover:bg-emerald-700"
            >
              New workflow
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="text-[10px] text-gray-400 hover:text-gray-700 underline"
            >
              Refresh
            </button>
          </>
        )}
      </div>

      {loading && <p className="text-xs text-gray-400">Loading workflows…</p>}
      {error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>}

      <div className="flex gap-4">
        {/* left: workflow list */}
        {!building && (
          <div className="flex flex-col gap-1.5 w-40 shrink-0">
            {workflows.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setSelected(w.id)}
                className={`w-full text-left rounded border px-3 py-2 text-[11px] transition-colors ${
                  w.id === selected ? 'border-blue-500 bg-blue-50 text-blue-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                }`}
              >
                <div className="font-semibold">{w.id}</div>
                <div className="text-[10px] text-gray-400">{w.phases.length} phases</div>
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
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{current.id}</span>
                <span className="text-[10px] text-gray-400">— {current.phases.length} phases</span>
                <button
                  type="button"
                  onClick={() => openBuilder(current)}
                  className="ml-auto text-[10px] text-blue-500 hover:underline"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => openBuilder({ ...current, id: `${current.id}-copy` })}
                  className="text-[10px] text-gray-400 hover:underline"
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
        <p className="text-[10px] text-gray-300">
          Workflows saved to <span className="font-mono">~/.wicked/workflows/</span> and registered immediately.
          Scripts saved to <span className="font-mono">~/.wicked/scripts/</span>.
        </p>
      )}
    </div>
  );
}
