import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { GateSpec, PhaseDef, PhaseExecutor, PresetStep, WorkflowDef } from '../api/types.js';
import { setCachedWorkflows } from '../store/workflowCache.js';
import { refusedWorkflowsOf, type RefusedWorkflow } from '../api/wave6-wire.js';
import { ApiError } from '../api/errors.js';
import { teamPlanApi, type CatalogEntry, type Preset } from '../api/teamPlan.js';

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

/** How a Tool step gets its command: the entry's own (`walkthrough_review`), a typed command, or a script. */
type ExecMode = 'inherit' | 'command' | 'script';
/** Every gate a step can state, one mode each (codex r2: a mode the builder could not hold was dropped). */
type GateMode = 'auto' | 'human' | 'human_always' | 'human_if' | 'consent';
type ScriptLang = 'bash' | 'python' | 'sh';
type StageKind = PhaseDef['kind'];

/**
 * One preset step as the builder holds it (X-MIG M11). It keeps only what the step STATES: a `null`
 * field inherits its catalog entry's value, which is what the engine composes. So reopening a saved
 * preset and saving it again sends the same step, and a field the builder has no control for rides
 * in `extra` untouched.
 */
export interface BuilderPhase {
  _key: string;
  id: string;
  /** The phase-catalog entry the step instantiates; its role comes from it. */
  catalog: string;
  /** `null` = the step states none, and the ENGINE gives it its inputs (an evaluator every earlier
   *  creator, `deliver` the step before it). An explicit list, even an empty one, replaces that. */
  dependsOn: string[] | null;
  /** A `run` step's stage (the only entry whose kind a step may set); `null` = the entry's. */
  kind: StageKind | null;
  instructions: string | null;
  /** `null` = the entry's gate. */
  gate: GateMode | null;
  /** `true` = declared by the step; `null` = the entry's. A step cannot clear an entry's flag. */
  executesCode: true | null;
  verifiedEvidence: true | null;
  skillRef: string | null;
  allowedSkills: string[];
  requiredDeliverables: string[];
  validatorPin: string | null;
  execMode: ExecMode;
  /** The command as typed: words split on whitespace, or a JSON argv (`["bash", "-lc", "a b"]`)
   *  when an argument holds a space, a quote or a newline ({@link commandText}). */
  cmd: string;
  script: string;
  scriptLang: ScriptLang;
  /** Every step field the builder has no control for, carried back verbatim. */
  extra: Record<string, unknown>;
}

/**
 * The step fields the builder edits, each with the values it can hold. A field whose value it cannot
 * hold (`validator_pin: null`, `executes_code: false`, a malformed list) rides in `extra` instead and
 * is sent back as stated, so the ENGINE judges it (a removal is refused as such) rather than the
 * builder quietly dropping it (codex r3).
 */
const isStrings = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');
const EDITED_FIELDS: Record<string, (v: unknown) => boolean> = {
  catalog: () => true,
  id: () => true,
  depends_on: isStrings,
  kind: (v) => typeof v === 'string',
  instructions: (v) => typeof v === 'string',
  gate: (v) => gateModeOf(v) !== null,
  executes_code: (v) => v === true,
  verified_evidence: (v) => v === true,
  skill_ref: (v) => typeof v === 'string',
  allowed_skills: isStrings,
  required_deliverables: isStrings,
  validator_pin: (v) => typeof v === 'string',
  executor: (v) => toolCmdOf(v) !== null,
};

/** A command as the builder shows it: plain words, or a JSON argv when a word would not survive a split. */
export function commandText(cmd: readonly string[]): string {
  return cmd.every((a) => /^[^\s"'[\]]+$/.test(a)) ? cmd.join(' ') : JSON.stringify(cmd);
}

/** The argv a typed command means (see {@link commandText}); throws on a JSON argv that is not one. */
export function commandArgv(text: string): string[] {
  const t = text.trim();
  if (t.startsWith('[')) {
    let argv: unknown;
    try {
      argv = JSON.parse(t);
    } catch {
      throw new Error(`The command \`${t}\` is not a JSON argv (a list of strings)`);
    }
    if (!isStrings(argv)) throw new Error(`The command \`${t}\` is not a JSON argv (a list of strings)`);
    return argv as string[];
  }
  return t.split(/\s+/).filter(Boolean);
}

function newKey(): string {
  return Math.random().toString(36).slice(2);
}

function gateModeOf(gate: unknown): GateMode | null {
  if (gate === 'auto') return 'auto';
  if (gate === 'consent_before') return 'consent';
  if (typeof gate !== 'object' || gate === null) return null;
  // Only a well-formed gate is a mode; anything else is carried as stated for the engine to judge.
  const keys = Object.keys(gate);
  if (keys.length !== 1) return null;
  if ('human_confirm_if' in gate) return (gate as { human_confirm_if: unknown }).human_confirm_if === 'verdict_not_pass' ? 'human_if' : null;
  if ('human_confirm' in gate) {
    const hc = (gate as { human_confirm: unknown }).human_confirm;
    if (typeof hc !== 'object' || hc === null) return null;
    const u = (hc as { unconditional?: unknown }).unconditional;
    return u === true ? 'human_always' : u === false ? 'human' : null;
  }
  return null;
}

function toolCmdOf(ex: unknown): string[] | null {
  if (typeof ex !== 'object' || ex === null || (ex as { type?: unknown }).type !== 'tool') return null;
  const cmd = (ex as { cmd?: unknown }).cmd;
  return Array.isArray(cmd) && cmd.every((a) => typeof a === 'string') ? (cmd as string[]) : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A saved preset's step as the builder holds it: exactly the fields it states. */
export function builderPhaseOfStep(step: PresetStep): BuilderPhase {
  const cmd = toolCmdOf(step['executor']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) if (!(EDITED_FIELDS[k]?.(v) ?? false)) extra[k] = v;
  return {
    _key: newKey(),
    id: step.id,
    catalog: step.catalog,
    // A malformed value is NOT read here (it rides in `extra`, as stated), so nothing overwrites it.
    dependsOn: isStrings(step['depends_on']) ? (step['depends_on'] as string[]) : null,
    kind: typeof step['kind'] === 'string' ? (step['kind'] as StageKind) : null,
    instructions: typeof step['instructions'] === 'string' ? step['instructions'] : null,
    gate: 'gate' in step ? gateModeOf(step['gate']) : null,
    executesCode: step['executes_code'] === true ? true : null,
    verifiedEvidence: step['verified_evidence'] === true ? true : null,
    skillRef: typeof step['skill_ref'] === 'string' ? step['skill_ref'] : null,
    allowedSkills: isStrings(step['allowed_skills']) ? (step['allowed_skills'] as string[]) : [],
    requiredDeliverables: isStrings(step['required_deliverables']) ? (step['required_deliverables'] as string[]) : [],
    validatorPin: typeof step['validator_pin'] === 'string' ? step['validator_pin'] : null,
    execMode: cmd !== null ? 'command' : 'inherit',
    cmd: cmd !== null ? commandText(cmd) : '',
    script: '',
    scriptLang: 'bash',
    extra,
  };
}

/** The catalog entry a def's phase maps onto (the §11.2 rule): a Tool phase is a `run` step; an agent
 *  phase by its kind and role. Only for a def that is NOT a preset (a JSON file in the old shape): a
 *  preset's steps already name their entries and are never re-derived. */
export function catalogOfPhase(p: Pick<PhaseDef, 'kind' | 'role' | 'executor'>): string {
  if (p.executor?.type === 'tool') return 'run';
  if (p.kind === 'recon') return 'understand';
  if (p.kind === 'test') return 'test';
  if (p.kind === 'review') return p.role === 'evaluator' ? 'review' : 'critique';
  return p.role === 'creator' ? 'build' : 'produce';
}

/** A def's phase (the old `{id, phases}` JSON shape) as a builder step. The entry is inferred and the
 *  phase's own values are stated, so the engine judges each one against the entry on save. */
export function builderPhaseOf(p: PhaseDef): BuilderPhase {
  const cmd = toolCmdOf(p.executor);
  const catalog = catalogOfPhase(p);
  return {
    _key: newKey(),
    id: p.id,
    catalog,
    // A hand-written file is read field by field: a value of the wrong shape is read as absent.
    dependsOn: strings(p.depends_on),
    kind: catalog === 'run' ? p.kind : null,
    instructions: typeof p.instructions === 'string' ? p.instructions : null,
    // `auto` asks for no gate, so the entry's applies; a human gate is stated (a raise, or refused).
    gate: p.gate === 'auto' ? null : gateModeOf(p.gate),
    executesCode: p.executes_code === true ? true : null,
    verifiedEvidence: p.verified_evidence === true ? true : null,
    skillRef: typeof p.skill_ref === 'string' ? p.skill_ref : null,
    allowedSkills: strings(p.allowed_skills),
    requiredDeliverables: strings(p.required_deliverables),
    validatorPin: typeof p.validator_pin === 'string' ? p.validator_pin : null,
    execMode: cmd !== null ? 'command' : 'inherit',
    cmd: cmd !== null ? commandText(cmd) : '',
    script: '',
    scriptLang: 'bash',
    extra: {},
  };
}

function emptyPhase(): BuilderPhase {
  return builderPhaseOfStep({ catalog: 'build', id: '' });
}

/**
 * The step moved onto another entry: the values that belonged to the OLD entry (its gate, flags,
 * skill, pin, stage, command) are dropped so the new entry's apply, and a stated pin or skill can
 * never be judged against an entry it was not written for. What the author wrote for the step itself
 * (id, order, instructions, deliverables) stays.
 */
export function withCatalog(p: BuilderPhase, catalog: string): BuilderPhase {
  return {
    ...p,
    catalog,
    kind: null,
    gate: null,
    executesCode: null,
    verifiedEvidence: null,
    skillRef: null,
    validatorPin: null,
    allowedSkills: [],
    execMode: 'inherit',
    cmd: '',
    script: '',
    // The fields with no control here (`writes_nothing`, `role`, `pool`, …) were the old step's too.
    extra: {},
  };
}

function toGateSpec(gate: GateMode): GateSpec {
  if (gate === 'human') return { human_confirm: { unconditional: false } };
  if (gate === 'human_always') return { human_confirm: { unconditional: true } };
  if (gate === 'human_if') return { human_confirm_if: 'verdict_not_pass' };
  if (gate === 'consent') return 'consent_before';
  return 'auto';
}

/** The executor a Tool step states, or `undefined` when it keeps its entry's own command. */
async function resolveExecutor(p: BuilderPhase): Promise<PhaseExecutor | undefined> {
  if (p.execMode === 'command') {
    const cmd = commandArgv(p.cmd);
    return cmd.length > 0 ? { type: 'tool', cmd } : undefined;
  }
  if (p.execMode === 'script') {
    const scriptName = p.id.trim() || `script-${p._key}`;
    const { path } = await api.saveScript(scriptName, p.script, p.scriptLang);
    const interp = p.scriptLang === 'python' ? 'python3' : p.scriptLang === 'sh' ? 'sh' : 'bash';
    return { type: 'tool', cmd: [interp, path] };
  }
  return undefined;
}

/** One preset step as `PUT /presets/:name` takes it. */
export type BuilderStep = PresetStep;

/**
 * The preset steps the builder's phases make. A step states only the fields the author set; the
 * ENGINE composes it over its entry and refuses a step that weakens the entry, naming the rule
 * (`PUT /presets` answers in its words).
 */
export async function buildPresetSteps(phases: BuilderPhase[]): Promise<BuilderStep[]> {
  return Promise.all(
    phases.map(async (p, i): Promise<BuilderStep> => {
      const step: BuilderStep = { ...p.extra, catalog: p.catalog, id: p.id || `phase-${i + 1}` };
      if (p.dependsOn !== null) step['depends_on'] = p.dependsOn;
      // A stated stage or command is SENT whatever the entry (codex r4): the engine allows them on
      // `run` / Tool entries only and refuses the rest by name. The builder never decides that from
      // a catalog it may not have loaded; a catalog change clears them ({@link withCatalog}).
      if (p.kind !== null) step['kind'] = p.kind;
      if (p.gate !== null) step['gate'] = toGateSpec(p.gate);
      // An empty string is a statement too (the engine reads its presence), so it is kept.
      if (p.instructions !== null) step['instructions'] = p.instructions;
      if (p.executesCode === true) step['executes_code'] = true;
      if (p.verifiedEvidence === true) step['verified_evidence'] = true;
      // F-RC1-093: carried back VERBATIM — a save used to null them on every workflow that had them.
      if (p.skillRef !== null) step['skill_ref'] = p.skillRef;
      if (p.allowedSkills.length > 0) step['allowed_skills'] = p.allowedSkills;
      if (p.requiredDeliverables.length > 0) step['required_deliverables'] = p.requiredDeliverables;
      if (p.validatorPin !== null) step['validator_pin'] = p.validatorPin;
      // With no command stated the step keeps its entry's own.
      const executor = await resolveExecutor(p);
      if (executor !== undefined) step['executor'] = executor;
      return step;
    }),
  );
}

/** A preset as the viewer lists it: each step laid over its entry (a reading of the preset, never launched). */
export function presetSummary(name: string, steps: readonly PresetStep[], entries: readonly CatalogEntry[]): WorkflowDef {
  return {
    id: name,
    phases: steps.map((st): PhaseDef => {
      const e = entries.find((x) => x.id === st.catalog);
      return {
        id: st.id,
        kind: (st['kind'] as StageKind | undefined) ?? e?.kind ?? 'build',
        instructions: typeof st['instructions'] === 'string' ? st['instructions'] : null,
        gate_type: e?.gate_type ?? null,
        gate: (st['gate'] as GateSpec | undefined) ?? e?.gate ?? 'auto',
        executes_code: st['executes_code'] === true || e?.executes_code === true,
        verified_evidence: st['verified_evidence'] === true || e?.verified_evidence === true,
        required_deliverables: strings(st['required_deliverables']),
        // Only the edges the step states: an omitted list is the engine's to fill at launch.
        depends_on: strings(st['depends_on']),
        role: e?.role ?? 'neutral',
        skill_ref: (st['skill_ref'] as string | undefined) ?? e?.skill_ref ?? null,
        allowed_skills: strings(st['allowed_skills']),
        validator_pin: (st['validator_pin'] as string | undefined) ?? e?.validator_pin ?? null,
        ...(st['executor'] !== undefined ? { executor: st['executor'] as PhaseExecutor } : {}),
      };
    }),
  };
}

/** A JSON file the builder can load: a preset (`{name, steps}`, what Preview shows) or an old def
 *  (`{id, phases}`). Parsed in full before anything is applied; `null` when it is neither. */
export function parseBuilderImport(text: string): { name: string; phases: BuilderPhase[] } | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof doc !== 'object' || doc === null) return null;
  const d = doc as { name?: unknown; id?: unknown; steps?: unknown; phases?: unknown };
  const isStep = (s: unknown): s is PresetStep =>
    typeof s === 'object' && s !== null && typeof (s as PresetStep).catalog === 'string' && typeof (s as PresetStep).id === 'string';
  const mapped = (f: () => BuilderPhase[]): BuilderPhase[] | null => {
    try {
      return f();
    } catch {
      return null;
    }
  };
  if (Array.isArray(d.steps) && d.steps.every(isStep)) {
    const steps = d.steps;
    const phases = mapped(() => steps.map(builderPhaseOfStep));
    return phases === null ? null : { name: typeof d.name === 'string' ? d.name : '', phases };
  }
  // A hand-written def may leave the optional-looking fields out; they read as the def defaults.
  const isPhase = (p: unknown): p is Partial<PhaseDef> & Pick<PhaseDef, 'id' | 'kind'> =>
    typeof p === 'object' && p !== null && typeof (p as PhaseDef).id === 'string' && typeof (p as PhaseDef).kind === 'string';
  if (Array.isArray(d.phases) && d.phases.every(isPhase)) {
    const defPhases = d.phases;
    const phases = mapped(() =>
      defPhases.map((p) => builderPhaseOf({ depends_on: [], executes_code: false, verified_evidence: false, gate: 'auto', gate_type: null, role: 'neutral', ...p } as PhaseDef)),
    );
    return phases === null ? null : { name: typeof d.id === 'string' ? d.id : '', phases };
  }
  return null;
}

/** Why a save under `name` cannot succeed before it is sent, or `null`. A built-in preset is read-only
 *  globally (the engine answers `preset_builtin_readonly`), so the builder asks for another name. */
export function saveBlockerOf(name: string, builtinNames: ReadonlySet<string>): string | null {
  if (name === '') return 'A preset name is required';
  if (builtinNames.has(name)) return `\`${name}\` is a built-in preset and is read-only — save your version under another name`;
  return null;
}

// ── Phase editor ───────────────────────────────────────────────────────────────

const inputStyle = { background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' };

function ToggleBtn({
  active,
  onClick,
  disabled = false,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...(title !== undefined ? { title } : {})}
      className="rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors disabled:opacity-40"
      style={active
        ? { background: 'var(--surface-card)', color: 'var(--ink-high)', border: '1px solid var(--surface-raised)' }
        : { background: 'transparent', color: 'var(--ink-dim)', border: '1px solid transparent' }
      }
    >
      {children}
    </button>
  );
}

const STAGE_KINDS: StageKind[] = ['recon', 'build', 'test', 'review'];

function PhaseEditor({
  phase,
  index,
  total,
  allIds,
  entries,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  phase: BuilderPhase;
  index: number;
  total: number;
  allIds: string[];
  /** The engine's phase catalog (`GET /catalog`): a step is one of its entries. */
  entries: CatalogEntry[];
  onChange: (p: BuilderPhase) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}): React.ReactElement {
  const up = <K extends keyof BuilderPhase,>(field: K, val: BuilderPhase[K]) => onChange({ ...phase, [field]: val });
  const prior = allIds.slice(0, index);
  const entry = entries.find((e) => e.id === phase.catalog);
  const toolEntry = entry?.executor === 'tool';
  // What the step does is its own value where it states one, else its entry's: the controls show that.
  const entryGate = entry ? gateModeOf(entry.gate) ?? 'auto' : 'auto';
  const gate = phase.gate ?? entryGate;
  const entryCode = entry?.executes_code === true;
  const entryEvidence = entry?.verified_evidence === true;
  const kind = phase.kind ?? entry?.kind ?? 'build';

  return (
    <div
      className="rounded p-3 flex flex-col gap-2"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
    >
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kindDotColor(kind) }} />
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

      {/* id + catalog entry */}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded px-2 py-1 text-xs focus:outline-none"
          placeholder="phase-id (e.g. build)"
          value={phase.id}
          onChange={(e) => up('id', e.target.value)}
          style={inputStyle}
        />
        <select
          data-testid="builder-step-catalog"
          className="rounded px-2 py-1 text-xs focus:outline-none"
          value={phase.catalog}
          onChange={(e) => onChange(withCatalog(phase, e.target.value))}
          style={inputStyle}
        >
          {(entries.some((x) => x.id === phase.catalog) ? entries.map((x) => x.id) : [phase.catalog, ...entries.map((x) => x.id)]).map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      {/* a Tool entry: the entry's own command, a typed command, or a script */}
      {toolEntry && (
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-1 items-center flex-wrap">
          {(['inherit', 'command', 'script'] as ExecMode[]).map((m) => (
            <ToggleBtn key={m} active={phase.execMode === m} onClick={() => up('execMode', m)}>
              {m === 'inherit' ? "Entry's command" : m === 'command' ? 'Command' : 'Script'}
            </ToggleBtn>
          ))}
          {phase.catalog === 'run' && (
            <select
              data-testid="builder-step-kind"
              aria-label="stage"
              className="rounded px-2 py-1 text-xs focus:outline-none"
              value={kind}
              onChange={(e) => up('kind', e.target.value === entry?.kind ? null : (e.target.value as StageKind))}
              style={inputStyle}
            >
              {STAGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
        </div>

        {phase.execMode === 'inherit' && (
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            The step states no command; it runs the one its entry fixes (an entry with none is refused on save).
          </p>
        )}

        {phase.execMode === 'command' && (
          <input
            className="rounded px-2 py-1 text-xs font-mono focus:outline-none"
            placeholder='e.g. npm run build  or  ["bash", "-lc", "echo a b"]'
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
      )}

      {/* gate + role */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex flex-col gap-0.5" data-testid="builder-step-gate" data-gate={gate}>
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Gate</span>
          <div className="flex gap-1">
            {([['auto', 'Auto'], ['human', 'Human'], ['human_always', 'Human (always)'], ['human_if', 'Human if fails'], ['consent', 'Consent before']] as [GateMode, string][]).map(([v, label]) => (
              <ToggleBtn
                key={v}
                active={gate === v}
                // A step may raise its entry's gate, never lower it to auto.
                disabled={v === 'auto' && entryGate !== 'auto'}
                {...(v === 'auto' && entryGate !== 'auto' ? { title: "the entry's gate cannot be lowered" } : {})}
                onClick={() => up('gate', v === entryGate ? null : v)}
              >
                {label}
              </ToggleBtn>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-0.5" data-testid="builder-step-role">
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>Role</span>
          <span className="text-[11px] font-mono" style={{ color: 'var(--ink-muted)' }}>
            {entry ? `${entry.role} · ${kind} (the catalog's)` : '—'}
          </span>
        </div>
      </div>

      {/* depends on */}
      {prior.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>
            Depends on{phase.dependsOn === null ? ' — none stated: the engine wires its inputs' : ''}
            {phase.dependsOn !== null && (
              <button
                type="button"
                data-testid="builder-step-deps-engine"
                onClick={() => up('dependsOn', null)}
                className="ml-2 hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                let the engine wire them
              </button>
            )}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {prior.map((pid) => (
              <label key={pid} className="flex items-center gap-1 text-[10px] cursor-pointer" style={{ color: 'var(--ink-muted)' }}>
                <input
                  type="checkbox"
                  checked={phase.dependsOn?.includes(pid) === true}
                  onChange={(e) => {
                    const deps = phase.dependsOn ?? [];
                    up('dependsOn', e.target.checked ? [...deps, pid] : deps.filter((d) => d !== pid));
                  }}
                />
                <span className="font-mono">{pid}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* flags: the entry's own is shown checked and cannot be cleared */}
      <div className="flex gap-3 text-[10px]" style={{ color: 'var(--ink-muted)' }}>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            data-testid="builder-step-executes-code"
            checked={entryCode || phase.executesCode === true}
            disabled={entryCode}
            onChange={(e) => up('executesCode', e.target.checked ? true : null)}
          />
          executes code
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            data-testid="builder-step-verified-evidence"
            checked={entryEvidence || phase.verifiedEvidence === true}
            disabled={entryEvidence}
            onChange={(e) => up('verifiedEvidence', e.target.checked ? true : null)}
          />
          verified evidence
        </label>
      </div>
    </div>
  );
}

// ── Workflow builder ───────────────────────────────────────────────────────────

/** What the builder opens on: a preset's own steps, or a def (a runtime-registered one) to convert. */
export type BuilderInitial = { name: string; steps: PresetStep[] } | { name: string; def: WorkflowDef };

function WorkflowBuilder({
  initial,
  builtinNames,
  onSaved,
  onCancel,
}: {
  initial?: BuilderInitial;
  /** The built-in presets' names: read-only, so a save under one is refused before it is sent. */
  builtinNames: ReadonlySet<string>;
  onSaved: (name: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const [workflowId, setWorkflowId] = useState(initial?.name ?? '');
  const [phases, setPhases] = useState<BuilderPhase[]>(() => {
    if (!initial) return [emptyPhase()];
    return 'steps' in initial ? initial.steps.map(builderPhaseOfStep) : initial.def.phases.map(builderPhaseOf);
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The engine's phase catalog: every step is one of its entries (X-MIG M11). */
  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    teamPlanApi.catalog().then((c) => setEntries(c.entries)).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const [showJson, setShowJson] = useState(false);
  const [previewJson, setPreviewJson] = useState('');

  const allIds = phases.map((p) => p.id).filter(Boolean);
  const blocker = saveBlockerOf(workflowId.trim(), builtinNames);

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
      const steps = await buildPresetSteps(phases);
      setPreviewJson(JSON.stringify({ name: workflowId, steps }, null, 2));
      setShowJson(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function handleSave() {
    const name = workflowId.trim();
    if (blocker !== null) { setError(blocker); return; }
    if (phases.length === 0) { setError('At least one phase is required'); return; }
    setSaving(true);
    setError(null);
    try {
      // X-MIG M11: the builder saves a PRESET (`PUT /presets/:name`); the engine composes its steps
      // over the catalog and refuses one that weakens its entry, in words (translateWireError).
      await teamPlanApi.putPreset(name, { steps: await buildPresetSteps(phases) });
      onSaved(name);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  const fileRef = useRef<HTMLInputElement>(null);
  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseBuilderImport(String(ev.target?.result ?? ''));
      if (parsed === null) {
        setError('Could not read that file: expected a preset ({name, steps}) or a workflow ({id, phases})');
        return;
      }
      setWorkflowId(parsed.name);
      setPhases(parsed.phases);
      setError(null);
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
          placeholder="preset name (e.g. my-deploy)"
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
            entries={entries}
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
      {error === null && blocker !== null && workflowId.trim() !== '' && (
        <p data-testid="builder-save-blocker" className="text-[11px]" style={{ color: 'var(--status-gate)' }}>{blocker}</p>
      )}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || (blocker !== null && workflowId.trim() !== '')}
        className="self-start rounded px-4 py-1.5 text-[11px] font-semibold disabled:opacity-50"
        style={{ background: 'var(--status-run)', color: 'var(--surface-base)' }}
      >
        {saving ? 'Saving…' : 'Save preset'}
      </button>
    </div>
  );
}

// ── Main panel ─────────────────────────────────────────────────────────────────

/**
 * The list the viewer shows: the daemon's workflow catalog (built-in presets and runtime-registered
 * defs), plus every saved user preset it does not already hold, read over the catalog. A system
 * preset (a machine-owned one) is left off, as the catalog leaves it off.
 */
export function viewerListOf(workflows: readonly WorkflowDef[], presets: readonly Preset[], entries: readonly CatalogEntry[]): WorkflowDef[] {
  // A launch resolves a preset before a registered def of the same name, so a saved user preset
  // REPLACES that row: the viewer shows what a launch of the name runs.
  const out = [...workflows];
  for (const p of [...presets].sort((a, b) => a.name.localeCompare(b.name))) {
    if (p.system === true || p.created_by === 'builtin') continue;
    const row = presetSummary(p.name, p.steps, entries);
    const at = out.findIndex((w) => w.id === p.name);
    if (at === -1) out.push(row);
    else out[at] = row;
  }
  return out;
}

export function WorkflowViewer(): React.ReactElement {
  const [workflows, setWorkflows] = useState<WorkflowDef[]>([]);
  /** The saved presets by name (`GET /presets`): Edit opens a preset from its OWN steps. */
  const [presets, setPresets] = useState<Map<string, Preset>>(new Map());
  /** (wicked-crew#718) The drop-in defs the ENGINE refused, with its reason. They are NOT in
   *  `workflows` — nothing can launch one — so without this row their author sees no trace of the
   *  file they wrote, and used to learn about the refusal only from a 400 `unknown workflow`. */
  const [refused, setRefused] = useState<RefusedWorkflow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [editTarget, setEditTarget] = useState<BuilderInitial | undefined>(undefined);

  // Use a ref so `load` doesn't capture `selected` as a dep — that would recreate
  // `load` on every selection change, causing the useEffect to re-fetch on every click.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const presetsRef = useRef<Map<string, Preset>>(new Map());

  const load = useCallback(async (select?: string) => {
    setLoading(true);
    setError(null);
    try {
      const answer = await api.listWorkflows();
      const wfs = answer.workflows;
      setRefused(refusedWorkflowsOf(answer));
      // Deposit for the app (studio#122 D-1): this surface RE-loads after every
      // create/delete, so the shared `is_system` cache the delivery surfaces
      // read stays current with the edits made here — and costs no extra GET.
      setCachedWorkflows(wfs);
      // X-MIG M11: the builder saves presets, so the saved ones are listed from the preset store
      // (a daemon without the routes lists the catalog alone).
      // A daemon without the route (404) has none; any other failure keeps the last good read and
      // says so, rather than silently dropping the saved rows (codex r3).
      const [saved, catalog] = await Promise.all([
        teamPlanApi.presets().then((r) => r.presets).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return [] as Preset[];
          setError(`Saved presets could not be read: ${e instanceof Error ? e.message : String(e)}`);
          return [...presetsRef.current.values()];
        }),
        teamPlanApi.catalog().then((c) => c.entries).catch(() => [] as CatalogEntry[]),
      ]);
      presetsRef.current = new Map(saved.map((p) => [p.name, p]));
      setPresets(presetsRef.current);
      const list = viewerListOf(wfs, saved, catalog);
      setWorkflows(list);
      if (select !== undefined) setSelected(select);
      else if (list.length > 0 && !selectedRef.current) setSelected(list[0]?.id ?? null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const builtinNames = new Set([...presets.values()].filter((p) => p.created_by === 'builtin').map((p) => p.name));

  /** Open the builder on `wf` under `name`: from the preset's own steps when it is one. */
  function openBuilder(wf?: WorkflowDef, name?: string) {
    if (wf === undefined) setEditTarget(undefined);
    else {
      const preset = presets.get(wf.id);
      const as = name ?? wf.id;
      setEditTarget(preset !== undefined ? { name: as, steps: preset.steps } : { name: as, def: wf });
    }
    setBuilding(true);
  }

  function onSaved(name: string) {
    setBuilding(false);
    void load(name);
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
      {refused.length > 0 && (
        <div
          data-testid="workflows-refused"
          data-count={refused.length}
          className="flex flex-col gap-1 rounded px-3 py-2"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--status-gate)' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: 'var(--status-gate)' }}>
            {refused.length === 1 ? 'A drop-in definition cannot be launched' : `${refused.length} drop-in definitions cannot be launched`} — the engine refused {refused.length === 1 ? 'it' : 'them'} at boot.
          </p>
          {refused.map((w) => (
            <p key={w.id} data-testid="workflows-refused-row" data-workflow={w.id} className="text-[10px]" style={{ color: 'var(--ink-muted)', overflowWrap: 'anywhere' }}>
              <span className="font-mono font-semibold">{w.id}</span> — {w.reason}
            </p>
          ))}
        </div>
      )}
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
              builtinNames={builtinNames}
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
                  data-testid="workflow-edit"
                  // A built-in preset is read-only: its Edit opens a copy to save under a new name.
                  onClick={() => openBuilder(current, builtinNames.has(current.id) ? `${current.id}-copy` : undefined)}
                  className="ml-auto text-[10px] hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => openBuilder(current, `${current.id}-copy`)}
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
          Presets are saved through the engine (<span className="font-mono">PUT /presets</span>) and launch by name.
          Scripts saved to <span style={{ color: 'var(--ink-dim)' }}>~/.wicked/scripts/</span>.
        </p>
      )}
    </div>
  );
}
