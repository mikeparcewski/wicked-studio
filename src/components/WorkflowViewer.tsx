import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import type { GateSpec, PhaseDef, PhaseExecutor, PresetStep, WorkflowDef } from '../api/types.js';
import { setCachedWorkflows } from '../store/workflowCache.js';
import { invalidatePresets } from '../store/planCatalog.js';
import { refusedWorkflowsOf, type RefusedWorkflow } from '../api/wave6-wire.js';
import { ApiError, readErrorKind } from '../api/errors.js';
import { PageFrame, SectionTitle } from './ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from './ui/StateBanner.js';
import { TechDetails } from './ui/TechDetails.js';
import { StatLine } from './ui/StatLine.js';
import { OverflowMenu } from './ui/OverflowMenu.js';
import { Switch } from './ui/Switch.js';
import { Segmented } from './ui/Segmented.js';
import { FilePick } from './ui/FilePick.js';
import { workflowLabel } from '../board/workflowNames.js';
import { teamPlanApi, type CatalogEntry, type Preset } from '../api/teamPlan.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

export function gateLabel(gate: GateSpec): string {
  if (gate === 'auto') return 'Auto';
  // Consent is asked BEFORE the step runs (an install, a push) — not a reading of its result.
  if (gate === 'consent_before') return 'Consent before';
  if (gate && typeof gate === 'object' && 'human_confirm' in gate) {
    return gate.human_confirm.unconditional ? 'Human (always)' : 'Human';
  }
  return 'Human if not PASS';
}

function PhaseCard({ phase, index }: { phase: PhaseDef; index: number }): React.ReactElement {
  return <div className="wk-card">
    <div className="wk-list-row">
      <div className="wk-list-row-title">Step {index + 1}: {phase.id.replace(/[-_]/g, ' ')}</div>
      <div className="wk-list-row-meta">
        {phase.role !== 'neutral' && <span className="wk-tag">{phase.role === 'creator' ? 'does the work' : 'checks the work'}</span>}
        <p className="wk-field-note">{gateLabel(phase.gate)}</p>
      </div>
    </div>
    <TechDetails text={JSON.stringify(phase, null, 2)} />
  </div>;
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
  // An empty argv is no command the builder can show: it rides in `extra`, for the engine to judge.
  return Array.isArray(cmd) && cmd.length > 0 && cmd.every((a) => typeof a === 'string') ? (cmd as string[]) : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** A saved preset's step as the builder holds it: exactly the fields it states. */
export function builderPhaseOfStep(step: PresetStep): BuilderPhase {
  const cmd = toolCmdOf(step['executor']);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    // An own-property lookup: an inherited name (`constructor`) is an unknown field, carried as stated.
    const holds = Object.hasOwn(EDITED_FIELDS, k) ? EDITED_FIELDS[k] : undefined;
    if (holds === undefined || !holds(v)) extra[k] = v;
  }
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

/** The step key each builder field writes: editing the field replaces whatever `extra` carried for it. */
const STEP_KEY_OF: Partial<Record<keyof BuilderPhase, string>> = {
  dependsOn: 'depends_on',
  kind: 'kind',
  instructions: 'instructions',
  gate: 'gate',
  executesCode: 'executes_code',
  verifiedEvidence: 'verified_evidence',
  skillRef: 'skill_ref',
  allowedSkills: 'allowed_skills',
  requiredDeliverables: 'required_deliverables',
  validatorPin: 'validator_pin',
  execMode: 'executor',
  cmd: 'executor',
  script: 'executor',
  scriptLang: 'executor',
};

/** `p` with `field` set by the author: the value carried in `extra` for that step key goes (codex r5). */
export function withField<K extends keyof BuilderPhase>(p: BuilderPhase, field: K, val: BuilderPhase[K]): BuilderPhase {
  const key = STEP_KEY_OF[field];
  if (key === undefined || !Object.hasOwn(p.extra, key)) return { ...p, [field]: val };
  const extra = { ...p.extra };
  delete extra[key];
  return { ...p, [field]: val, extra };
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
  const up = <K extends keyof BuilderPhase,>(field: K, val: BuilderPhase[K]) => onChange(withField(phase, field, val));
  const prior = allIds.slice(0, index);
  // A stated dependency on a step that is no longer before this one stays listed (unchecking it, or
  // handing the list back to the engine, is how the author repairs it — codex r7).
  const dangling = (phase.dependsOn ?? []).filter((d) => !prior.includes(d));
  const depChoices = [...prior, ...dangling];
  const entry = entries.find((e) => e.id === phase.catalog);
  const toolEntry = entry?.executor === 'tool';
  // What the step does is its own value where it states one, else its entry's: the controls show that.
  const entryGate = entry ? gateModeOf(entry.gate) ?? 'auto' : 'auto';
  const gate = phase.gate ?? entryGate;
  const entryCode = entry?.executes_code === true;
  const entryEvidence = entry?.verified_evidence === true;
  const kind = phase.kind ?? entry?.kind ?? 'build';

  return (
    <section className="wk-card wk-pg-set-stack">
      <div className="wk-pg-set-heading">
        <SectionTitle>Step {index + 1}</SectionTitle>
        <OverflowMenu label={`More actions for step ${index + 1}`} items={[
          { id: 'up', label: 'Move up', onSelect: onMoveUp, disabled: index === 0 ? 'This is the first step.' : null },
          { id: 'down', label: 'Move down', onSelect: onMoveDown, disabled: index === total - 1 ? 'This is the last step.' : null },
          { id: 'remove', label: 'Remove step', onSelect: onRemove, danger: true },
        ]} />
      </div>
      <label>Step name<input className="wk-field" placeholder="Step name, such as build" value={phase.id} onChange={(e) => up('id', e.target.value)} /></label>
      <label>Step type<select data-testid="builder-step-catalog" className="wk-field" value={phase.catalog} onChange={(e) => onChange(withCatalog(phase, e.target.value))}>
        {(entries.some((x) => x.id === phase.catalog) ? entries.map((x) => x.id) : [phase.catalog, ...entries.map((x) => x.id)]).map((id) => <option key={id} value={id}>{id}</option>)}
      </select></label>
      {toolEntry && <>
        <Segmented label="Command source" value={phase.execMode} options={[
          { value: 'inherit', label: "Entry's command" }, { value: 'command', label: 'Command' }, { value: 'script', label: 'Script' },
        ]} onChange={(v) => up('execMode', v)} />
        {phase.catalog === 'run' && <label>Stage<select data-testid="builder-step-kind" aria-label="stage" className="wk-field" value={kind} onChange={(e) => up('kind', e.target.value === entry?.kind ? null : e.target.value as StageKind)}>
          {STAGE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select></label>}
        {phase.execMode === 'inherit' && <p className="wk-field-note">Uses the command provided by this step type.</p>}
        {phase.execMode === 'command' && <label>Command<input className="wk-field font-mono" placeholder="Command to run, such as npm test" value={phase.cmd} onChange={(e) => up('cmd', e.target.value)} /></label>}
        {phase.execMode === 'script' && <>
          <Segmented label="Script language" value={phase.scriptLang} options={(['bash', 'sh', 'python'] as ScriptLang[]).map((value) => ({ value, label: value }))} onChange={(v) => up('scriptLang', v)} />
          <label>Script<textarea className="wk-field font-mono" rows={6} placeholder={phase.scriptLang === 'python' ? '# python script\nprint("hello")' : '# bash script\necho "hello"'} value={phase.script} onChange={(e) => up('script', e.target.value)} /></label>
          <TechDetails text={`Saved to ~/.wicked/scripts/${phase.id || 'script'}.${phase.scriptLang === 'python' ? 'py' : 'sh'}`} />
        </>}
      </>}
      <div data-testid="builder-step-gate" data-gate={gate}>
        <label>Approval<select className="wk-field" value={gate} onChange={(e) => up('gate', e.target.value === entryGate ? null : e.target.value as GateMode)}>
          {([['auto', 'Auto'], ['human', 'Human'], ['human_always', 'Human (always)'], ['human_if', 'Human if fails'], ['consent', 'Consent before']] as [GateMode, string][]).map(([v, label]) => <option key={v} value={v} disabled={v === 'auto' && entryGate !== 'auto'}>{label}</option>)}
        </select></label>
        {entryGate !== 'auto' && <p className="wk-field-note">This step type requires approval; automatic approval is unavailable.</p>}
      </div>
      <div data-testid="builder-step-role">{entry && <span className="wk-tag">{entry.role === 'creator' ? 'does the work' : entry.role === 'evaluator' ? 'checks the work' : 'supports the work'}</span>}</div>
      {(depChoices.length > 0 || phase.dependsOn !== null) && <div data-testid="builder-step-deps" className="wk-pg-set-stack">
        <p className="wk-field-note">{phase.dependsOn === null ? 'Previous steps are connected automatically.' : 'Choose the earlier steps this one needs.'}</p>
        {phase.dependsOn !== null && <button type="button" data-testid="builder-step-deps-engine" className="wk-btn wk-btn--secondary" onClick={() => up('dependsOn', null)}>Connect steps automatically</button>}
        {depChoices.map((pid) => <div key={pid} {...(dangling.includes(pid) ? { 'data-dangling': 'true' } : {})}>
          <Switch label={pid} checked={phase.dependsOn?.includes(pid) === true} onChange={(checked) => { const deps = phase.dependsOn ?? []; up('dependsOn', checked ? [...deps, pid] : deps.filter((d) => d !== pid)); }} />
          {dangling.includes(pid) && <p className="wk-field-note">This step is no longer before the current step.</p>}
        </div>)}
      </div>}
      <Switch label="Executes code" data-testid="builder-step-executes-code" checked={entryCode || phase.executesCode === true} disabled={entryCode ? 'Required by this step type.' : null} onChange={(v) => up('executesCode', v ? true : null)} />
      <Switch label="Verified evidence" data-testid="builder-step-verified-evidence" checked={entryEvidence || phase.verifiedEvidence === true} disabled={entryEvidence ? 'Required by this step type.' : null} onChange={(v) => up('verifiedEvidence', v ? true : null)} />
    </section>
  );
}

// ── Workflow builder ───────────────────────────────────────────────────────────

/** What the builder opens on: a preset's own steps, or a def (a runtime-registered one) to convert. */
export type BuilderInitial = { name: string; steps: PresetStep[] } | { name: string; def: WorkflowDef };

function WorkflowBuilder({
  initial,
  builtinNames,
  initialEntries,
  onSaved,
  onCancel,
}: {
  initial?: BuilderInitial;
  /** The built-in presets' names: read-only, so a save under one is refused before it is sent. */
  builtinNames: ReadonlySet<string>;
  /** The catalog the viewer last read: the editor shows inherited values from it until its own
   *  read answers, and keeps it if that read fails (codex r7). */
  initialEntries: CatalogEntry[];
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
  const [errorSource, setErrorSource] = useState<unknown>(null);
  /** The engine's phase catalog: every step is one of its entries (X-MIG M11). */
  const [entries, setEntries] = useState<CatalogEntry[]>(initialEntries);
  useEffect(() => {
    teamPlanApi
      .catalog()
      .then((c) => setEntries(c.entries))
      .catch((e: unknown) => { setErrorSource(e); setError(`The phase catalog could not be read: ${e instanceof Error ? e.message : String(e)}`); });
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
    } catch (e) { setErrorSource(e); setError(e instanceof Error ? e.message : String(e)); }
  }

  async function handleSave() {
    const name = workflowId.trim();
    if (blocker !== null) { setErrorSource(null); setError(blocker); return; }
    if (phases.length === 0) { setErrorSource(null); setError('At least one step is required'); return; }
    setSaving(true);
    setError(null);
    setErrorSource(null);
    try {
      // X-MIG M11: the builder saves a PRESET (`PUT /presets/:name`); the engine composes its steps
      // over the catalog and refuses one that weakens its entry, in words (translateWireError).
      await teamPlanApi.putPreset(name, { steps: await buildPresetSteps(phases) });
      onSaved(name);
    } catch (e) { setErrorSource(e); setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }

  const [importFile, setImportFile] = useState<File | null>(null);
  function handleUpload(file: File | null) {
    setImportFile(file);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseBuilderImport(String(ev.target?.result ?? ''));
      if (parsed === null) {
        setErrorSource(null);
        setError('Could not read that file: expected a preset ({name, steps}) or a workflow ({id, phases})');
        return;
      }
      setWorkflowId(parsed.name);
      setPhases(parsed.phases);
      setError(null);
    };
    reader.readAsText(file);
  }

  return (
    <div className="wk-pg-set-stack">
      {/* toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          className="wk-field"
          aria-label="Workflow name"
          placeholder="Workflow name, such as my-deploy"
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
        />
        <FilePick label="Upload JSON" accept=".json" file={importFile} onChange={handleUpload} />
        <button
          type="button"
          onClick={() => void handlePreview()}
          className="wk-btn wk-btn--secondary"
        >
          Preview JSON
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="wk-btn wk-btn--quiet"
        >
          Cancel
        </button>
      </div>

      {showJson && <TechDetails summary="JSON preview" text={previewJson} defaultOpen />}

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
        className="wk-btn wk-btn--secondary"
      >
        + Add step
      </button>

      {/* A check on what you entered is a note on the form; a failed read or save is the page banner, and only the
          catalog read offers Retry (retrying a read must not stand in for a failed save). */}
      {error && errorSource === null && <p className="wk-field-note wk-field-note--bad" data-testid="workflow-builder-note">{error}</p>}
      {error && errorSource !== null && <StateBanner kind={readErrorKind(errorSource)} what={error.startsWith('The phase catalog could not be read') ? 'the step catalog' : 'your workflow changes'} error={error}
        {...(error.startsWith('The phase catalog could not be read') ? { onRetry: () => { setError(null); setErrorSource(null); void teamPlanApi.catalog().then((c) => setEntries(c.entries)).catch((e: unknown) => { setErrorSource(e); setError(`The phase catalog could not be read: ${e instanceof Error ? e.message : String(e)}`); }); } } : {})} />}
      {blocker !== null && (
        <p data-testid="builder-save-blocker" className="wk-field-note">{blocker}</p>
      )}

      {saving && <p className="wk-field-note">Wait for this workflow to finish saving.</p>}
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={saving || blocker !== null}
        className="wk-btn wk-btn--primary"
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
  const [errorSource, setErrorSource] = useState<unknown>(null);
  const [building, setBuilding] = useState(false);
  const [editTarget, setEditTarget] = useState<BuilderInitial | undefined>(undefined);

  // Use a ref so `load` doesn't capture `selected` as a dep — that would recreate
  // `load` on every selection change, causing the useEffect to re-fetch on every click.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const presetsRef = useRef<Map<string, Preset>>(new Map());
  const catalogRef = useRef<CatalogEntry[]>([]);

  const load = useCallback(async (select?: string) => {
    setLoading(true);
    setError(null);
    setErrorSource(null);
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
          setErrorSource((previous: unknown) => readErrorKind(previous) === 'offline' ? previous : e);
          setError(`Saved presets could not be read: ${e instanceof Error ? e.message : String(e)}`);
          return [...presetsRef.current.values()];
        }),
        // The same for the catalog the saved presets are read over: a failed read keeps the last
        // good one and says so, rather than showing every inherited gate and role as a default.
        teamPlanApi.catalog().then((c) => c.entries).catch((e: unknown) => {
          if (e instanceof ApiError && e.status === 404) return [] as CatalogEntry[];
          setErrorSource((previous: unknown) => readErrorKind(previous) === 'offline' ? previous : e);
          setError(`The phase catalog could not be read: ${e instanceof Error ? e.message : String(e)}`);
          return catalogRef.current;
        }),
      ]);
      catalogRef.current = catalog;
      presetsRef.current = new Map(saved.map((p) => [p.name, p]));
      setPresets(presetsRef.current);
      const list = viewerListOf(wfs, saved, catalog);
      setWorkflows(list);
      if (select !== undefined) setSelected(select);
      else if (list.length > 0 && !selectedRef.current) setSelected(list[0]?.id ?? null);
    } catch (e) { setErrorSource(e); setError(e instanceof Error ? e.message : String(e)); }
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
    // The composer's `/` menu and the launch preview cache presets: they read the store again.
    invalidatePresets();
    void load(name);
  }

  const current = workflows.find((w) => w.id === selected) ?? null;

  return (
    <PageFrame title="Workflows" intro="Browse the steps for your work or create your own workflow."
      actions={!building ? <>
        <button type="button" className="wk-btn wk-btn--primary" onClick={() => openBuilder()} disabled={loading || error !== null}>New workflow</button>
        <button type="button" className="wk-btn wk-btn--secondary" onClick={() => void load()}>Refresh</button>
      </> : undefined}>
      {!building && (loading || error !== null) && <p className="wk-field-note">{loading ? 'Wait for workflows to load before creating one.' : 'Refresh workflows before creating one.'}</p>}
      {!building && error && <StateBanner kind={readErrorKind(errorSource ?? error)} what="workflows" error={error} onRetry={() => void load()} retrying={loading} />}
      <p className="wk-field-note">The composer's / menu offers workflows for starting work, including saved workflows for the current project; setup and background workflows have their own entry points. It shows up to eight matches as you type.</p>
      {loading && <Skeleton rows={4} />}
      {!loading && error === null && refused.length > 0 && <section className="wk-card" data-testid="workflows-refused" data-count={refused.length}>
        <SectionTitle>Unavailable workflows</SectionTitle>
        <p>{refused.length === 1 ? 'A workflow cannot be launched.' : 'Some workflows cannot be launched.'}</p>
        {refused.map((w) => <div key={w.id} data-testid="workflows-refused-row" data-workflow={w.id} className="wk-list-row">
          <div className="wk-list-row-title">{workflowLabel(w.id)}</div>
          <div className="wk-list-row-meta"><TechDetails text={w.reason} /></div>
        </div>)}
      </section>}
      {!loading && !building && error === null && workflows.length === 0 && <EmptyState title="No workflows yet." body="Use New workflow to choose the steps for your work." />}
      <div className={building ? 'wk-pg-set-stack' : 'wk-pg-set-workflows'}>
        {!building && !loading && <section className="wk-card">
          <SectionTitle>Available workflows</SectionTitle>
          {workflows.map((w) => <div className="wk-list-row" key={w.id}>
            <div className="wk-list-row-title"><button type="button" className="wk-chip" aria-pressed={w.id === selected} onClick={() => setSelected(w.id)}>{workflowLabel(w.id)}</button></div>
            <div className="wk-list-row-meta">{error === null && <StatLine items={[{ label: w.phases.length === 1 ? 'step' : 'steps', value: w.phases.length }]} />}</div>
          </div>)}
        </section>}
        <div className="min-w-0">
          {building ? <WorkflowBuilder {...(editTarget !== undefined ? { initial: editTarget } : {})} builtinNames={builtinNames} initialEntries={catalogRef.current} onSaved={onSaved} onCancel={() => setBuilding(false)} />
            : !loading && current ? <section className="wk-pg-set-stack">
              <div className="wk-pg-set-heading">
                <SectionTitle>Steps in {workflowLabel(current.id)}</SectionTitle>
                {error === null && <StatLine items={[{ label: current.phases.length === 1 ? 'step' : 'steps', value: current.phases.length }]} />}
                <div className="wk-list-row-actions" data-testid="workflow-edit">
                  <OverflowMenu label={`More actions for ${workflowLabel(current.id)}`} items={[
                    { id: 'edit', label: 'Edit', onSelect: () => openBuilder(current, builtinNames.has(current.id) ? `${current.id}-copy` : undefined) },
                    { id: 'duplicate', label: 'Duplicate', onSelect: () => openBuilder(current, `${current.id}-copy`) },
                  ]} />
                </div>
              </div>
              {current.phases.map((p, i) => <PhaseCard key={p.id} phase={p} index={i} />)}
            </section> : null}
        </div>
      </div>
    </PageFrame>
  );
}
