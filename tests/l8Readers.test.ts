// fixall L8-8E(ii)/(iv) + the run clock — pure readers: `api.getRunDiff` sends `base=merge-base`
// (studio #244; BC-54), `runWhenWord` prefers the run's own `created_at` and `runEndedWord` never
// derives a duration for an undated run (crew #496 / studio #230; BC-52), and the workflow builder
// round-trips `skill_ref` / `allowed_skills` / `required_deliverables` / `validator_pin` (F-RC1-093).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { runEndedWord, runWhenWord } from '../src/components/runIdentity.js';
import {
  buildPresetSteps,
  builderPhaseOf,
  builderPhaseOfStep,
  catalogOfPhase,
  parseBuilderImport,
  saveBlockerOf,
  viewerListOf,
  withCatalog,
} from '../src/components/WorkflowViewer.js';
import type { CatalogEntry, Preset } from '../src/api/teamPlan.js';
import type { PhaseDef, WorkflowDef } from '../src/api/types.js';

function setLocation(url: string): void {
  Object.defineProperty(window, 'location', { value: new URL(url), writable: true, configurable: true });
}

describe('api.getRunDiff — base=merge-base (studio #244)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('VITE_API_HOST', '');
    setLocation('http://127.0.0.1:7788/');
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const calledUrl = (): string => String((fetchMock.mock.calls[0] as unknown[])[0]);

  it('omitted ⇒ the pre-field call (worktree vs HEAD); path alone ⇒ ?path=', async () => {
    await api.getRunDiff('r-1');
    expect(calledUrl()).toBe('http://127.0.0.1:7788/api/v1/runs/r-1/diff');
    fetchMock.mockClear();
    await api.getRunDiff('r-1', '/work/src/foo.ts');
    expect(calledUrl()).toBe('http://127.0.0.1:7788/api/v1/runs/r-1/diff?path=%2Fwork%2Fsrc%2Ffoo.ts');
  });

  it('base alone ⇒ ?base=merge-base; both ⇒ path then base', async () => {
    await api.getRunDiff('r-1', undefined, 'merge-base');
    expect(calledUrl()).toBe('http://127.0.0.1:7788/api/v1/runs/r-1/diff?base=merge-base');
    fetchMock.mockClear();
    await api.getRunDiff('r-1', '/work/a.ts', 'merge-base');
    expect(calledUrl()).toBe('http://127.0.0.1:7788/api/v1/runs/r-1/diff?path=%2Fwork%2Fa.ts&base=merge-base');
  });
});

describe('run clocks — the run record first, the attach clock as the fallback it always was', () => {
  const now = 1_700_000_000_000;
  it('runWhenWord prefers created_at (unix SECONDS) when the daemon dates the run', () => {
    expect(runWhenWord(now - 5 * 60_000, now, 1_700_000_000 - 3600)).toBe('1h ago');
    expect(runWhenWord(now - 5 * 60_000, now)).toBe('5m ago');
    expect(runWhenWord(undefined, now)).toBe('time unknown');
    // a bad created_at never masks the attach clock
    expect(runWhenWord(now - 5 * 60_000, now, Number.NaN)).toBe('5m ago');
  });
  it('runEndedWord renders ended_at and answers null — never a fabricated duration — when undated', () => {
    expect(runEndedWord(1_700_000_000 - 120, now)).toBe('finished 2m ago');
    expect(runEndedWord(undefined, now)).toBeNull();
  });
});

describe('preset builder round-trip (F-RC1-093; X-MIG M11: the builder saves a preset)', () => {
  const phase: PhaseDef = {
    id: 'churn',
    kind: 'recon',
    gate_type: 'value',
    gate: 'auto',
    executes_code: false,
    verified_evidence: false,
    required_deliverables: ['NOTES.md'],
    depends_on: [],
    role: 'neutral',
    skill_ref: 'wicked-garden-repo-learn',
    allowed_skills: ['wicked-garden-search'],
    validator_pin: 'wicked-validator:evidence-floor@1',
  };
  const def: WorkflowDef = { id: 'capture-learnings', phases: [phase, { ...phase, id: 'hotspots', depends_on: ['churn'], executor: { type: 'tool', cmd: ['echo', 'hi'] } }] };

  it('a def maps onto catalog steps: an agent recon phase is `understand`, a Tool phase is `run`', () => {
    expect(def.phases.map(catalogOfPhase)).toEqual(['understand', 'run']);
    expect(catalogOfPhase({ kind: 'build', role: 'creator' })).toBe('build');
    expect(catalogOfPhase({ kind: 'build', role: 'neutral' })).toBe('produce');
    expect(catalogOfPhase({ kind: 'review', role: 'evaluator' })).toBe('review');
    expect(catalogOfPhase({ kind: 'review', role: 'neutral' })).toBe('critique');
    expect(catalogOfPhase({ kind: 'test', role: 'evaluator' })).toBe('test');
  });

  it('builderPhaseOf carries the four fields; buildPresetSteps writes them back verbatim (was: nulled on every save)', async () => {
    const steps = await buildPresetSteps(def.phases.map(builderPhaseOf));
    expect(steps.map((s) => [s.catalog, s.id, s['skill_ref'], s['allowed_skills'], s['required_deliverables'], s['validator_pin']])).toEqual([
      ['understand', 'churn', 'wicked-garden-repo-learn', ['wicked-garden-search'], ['NOTES.md'], 'wicked-validator:evidence-floor@1'],
      ['run', 'hotspots', 'wicked-garden-repo-learn', ['wicked-garden-search'], ['NOTES.md'], 'wicked-validator:evidence-floor@1'],
    ]);
    // A Tool step carries its command and its stage; an agent step carries no executor at all.
    expect(steps[1]!['executor']).toEqual({ type: 'tool', cmd: ['echo', 'hi'] });
    expect(steps[1]!['kind']).toBe('recon');
    expect('executor' in steps[0]!).toBe(false);
    // An `auto` gate is the entry's own: not stated.
    expect('gate' in steps[0]!).toBe(false);
  });

  it('a def without the fields (older shape) still builds — the step states none of them', async () => {
    const bare = { ...phase } as Partial<PhaseDef> as PhaseDef;
    delete (bare as Partial<PhaseDef>).skill_ref;
    delete (bare as Partial<PhaseDef>).allowed_skills;
    delete (bare as Partial<PhaseDef>).required_deliverables;
    delete (bare as Partial<PhaseDef>).validator_pin;
    const [step] = await buildPresetSteps([builderPhaseOf(bare)]);
    expect(step).toEqual({ catalog: 'understand', id: 'churn', depends_on: [] });
  });
});

describe('the preset builder keeps a preset exactly as saved (codex r1 on studio B)', () => {
  const entry = (id: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
    id,
    kind: 'build',
    role: 'creator',
    gate: 'auto',
    gate_type: null,
    executes_code: false,
    executor: 'agent',
    validator_pin: null,
    pinned: false,
    evidence_floor: false,
    verified_evidence: false,
    skill_ref: null,
    description: null,
    ...over,
  });
  const entries: CatalogEntry[] = [
    entry('produce'),
    entry('build', { executes_code: true, validator_pin: 'floor@1', pinned: true }),
    entry('test', { kind: 'test', role: 'evaluator', gate: { human_confirm_if: 'verdict_not_pass' }, verified_evidence: true }),
    entry('domain_coverage', { kind: 'test', role: 'evaluator', validator_pin: 'coverage@1', pinned: true }),
    entry('run', { kind: 'recon', role: 'neutral', executor: 'tool' }),
    entry('walkthrough_review', { kind: 'test', role: 'neutral', executor: 'tool' }),
  ];

  it('(1) a saved step keeps its catalog entry on reopen and resave: `produce` is never re-derived as `build`', async () => {
    const saved = [
      { catalog: 'produce', id: 'write', instructions: 'Write it.' },
      { catalog: 'domain_coverage', id: 'coverage', depends_on: ['write'] },
      { catalog: 'run', id: 'lint', kind: 'test', executor: { type: 'tool', cmd: ['npm', 'run', 'lint'] }, pool: 1 },
    ];
    const again = await buildPresetSteps(saved.map(builderPhaseOfStep), entries);
    expect(again).toEqual([
      { catalog: 'produce', id: 'write', instructions: 'Write it.' },
      { catalog: 'domain_coverage', id: 'coverage', depends_on: ['write'] },
      // (4) the run step's stage and (extra) a field the builder has no control for both survive.
      { catalog: 'run', id: 'lint', kind: 'test', executor: { type: 'tool', cmd: ['npm', 'run', 'lint'] }, pool: 1 },
    ]);
  });

  it('(3) moving a step onto another entry drops what belonged to the old one (pin, skill, gate, flags, command)', () => {
    const p = builderPhaseOf({
      id: 't', kind: 'test', role: 'evaluator', gate: { human_confirm: { unconditional: false } }, gate_type: null,
      executes_code: true, verified_evidence: true, depends_on: ['a'], required_deliverables: ['R.md'],
      skill_ref: 'wicked-garden-qe', allowed_skills: [], validator_pin: 'floor@1', instructions: 'Check it.',
    });
    const moved = withCatalog(p, 'domain_coverage');
    expect(moved).toMatchObject({
      catalog: 'domain_coverage', validatorPin: null, skillRef: null, gate: null, executesCode: null, verifiedEvidence: null,
      // what the author wrote for the step itself stays
      id: 't', dependsOn: ['a'], requiredDeliverables: ['R.md'], instructions: 'Check it.',
    });
  });

  it("(5) an entry's own gate and flags are inherited, not cleared: a new test step states no gate and no flag", async () => {
    const [step] = await buildPresetSteps([withCatalog(builderPhaseOfStep({ catalog: 'build', id: '' }), 'test')], entries);
    expect(step).toEqual({ catalog: 'test', id: 'phase-1' });
  });

  it("(6) a Tool step with no command stated keeps its entry's own (walkthrough_review); a typed one is sent", async () => {
    const own = builderPhaseOfStep({ catalog: 'walkthrough_review', id: 'walk' });
    expect(own.execMode).toBe('inherit');
    const [a, b] = await buildPresetSteps([own, { ...own, id: 'blank', execMode: 'command', cmd: '  ' }], entries);
    expect('executor' in a!).toBe(false);
    expect('executor' in b!).toBe(false);
    const [c] = await buildPresetSteps([{ ...own, execMode: 'command', cmd: 'x --y' }], entries);
    expect(c!['executor']).toEqual({ type: 'tool', cmd: ['x', '--y'] });
  });

  it('(7) Upload reads what Preview shows ({name, steps}), still reads an old def, and rejects anything else', () => {
    const preview = JSON.stringify({ name: 'mine', steps: [{ catalog: 'produce', id: 'write' }] });
    expect(parseBuilderImport(preview)).toMatchObject({ name: 'mine', phases: [{ catalog: 'produce', id: 'write' }] });
    const old = JSON.stringify({ id: 'legacy', phases: [{ id: 'scan', kind: 'recon' }] });
    expect(parseBuilderImport(old)).toMatchObject({ name: 'legacy', phases: [{ catalog: 'understand', id: 'scan' }] });
    expect(parseBuilderImport('{"name":"x","steps":[{"id":"no-catalog"}]}')).toBeNull();
    expect(parseBuilderImport('not json')).toBeNull();
  });

  it('(8) a built-in name is refused before the save is sent; another name is not', () => {
    const builtins = new Set(['feature', 'bug']);
    expect(saveBlockerOf('feature', builtins)).toMatch(/built-in preset and is read-only/);
    expect(saveBlockerOf('feature-copy', builtins)).toBeNull();
    expect(saveBlockerOf('', builtins)).toBe('A preset name is required');
  });

  it('(2) a saved user preset is listed after a reload, from the preset store; built-ins and system presets are not doubled', () => {
    const preset = (name: string, over: Partial<Preset> = {}): Preset => ({
      name, scope: 'global', steps: [{ catalog: 'produce', id: 'write' }], created_by: 'studio', updated_at: 0, ...over,
    });
    const list = viewerListOf(
      [{ id: 'feature', phases: [] }],
      [preset('feature', { created_by: 'builtin' }), preset('chat', { created_by: 'builtin', system: true }), preset('mine'), preset('feature')],
      entries,
    );
    expect(list.map((w) => w.id)).toEqual(['feature', 'mine']);
    expect(list[1]!.phases.map((p) => [p.id, p.role])).toEqual([['write', 'creator']]);
  });
});

describe('the preset builder round-trip, codex r2 on studio B', () => {
  it('(1) every gate a step can state survives a no-change save: consent, unconditional and conditional human', async () => {
    const saved = [
      { catalog: 'run', id: 'install', gate: 'consent_before', executor: { type: 'tool', cmd: ['i'] } },
      { catalog: 'design', id: 'design', gate: { human_confirm: { unconditional: true } } },
      { catalog: 'understand', id: 'scope', gate: { human_confirm: { unconditional: false } } },
      { catalog: 'review', id: 'obs', gate: { human_confirm_if: 'verdict_not_pass' } },
    ];
    const again = await buildPresetSteps(saved.map(builderPhaseOfStep));
    expect(again.map((st) => st['gate'])).toEqual(saved.map((st) => st.gate));
  });

  it('(2) an omitted depends_on stays omitted (the engine wires the inputs); an explicit empty list stays explicit', async () => {
    const [a, b] = await buildPresetSteps([
      builderPhaseOfStep({ catalog: 'review', id: 'review' }),
      builderPhaseOfStep({ catalog: 'build', id: 'b', depends_on: [] }),
    ]);
    expect('depends_on' in a!).toBe(false);
    expect(b!['depends_on']).toEqual([]);
  });

  it('(3) an unchanged command is sent with its argv as saved: an argument holding spaces or a script stays one argument', async () => {
    const cmd = ['bash', '-lc', 'echo hello\nexit 0', ''];
    const p = builderPhaseOfStep({ catalog: 'run', id: 'verify', executor: { type: 'tool', cmd } });
    const [same] = await buildPresetSteps([p]);
    expect(same!['executor']).toEqual({ type: 'tool', cmd });
    const [edited] = await buildPresetSteps([{ ...p, cmd: 'npm test' }]);
    expect(edited!['executor']).toEqual({ type: 'tool', cmd: ['npm', 'test'] });
  });

  it('(4) moving a step onto another entry drops the fields with no control too (writes_nothing, role, pool)', async () => {
    const p = builderPhaseOfStep({ catalog: 'produce', id: 'propose', writes_nothing: true, role: 'creator', pool: 2 });
    const [step] = await buildPresetSteps([withCatalog(p, 'build')]);
    expect(step).toEqual({ catalog: 'build', id: 'propose' });
  });

  it('(5) an import whose step fields have the wrong shape is refused as unreadable, never thrown', () => {
    const bad = JSON.stringify({ name: 'x', steps: [{ catalog: 'run', id: 'r', executor: { type: 'tool', cmd: 'echo hello' } }] });
    expect(() => parseBuilderImport(bad)).not.toThrow();
    // A malformed executor is read as no command stated (the entry's own); the step itself loads.
    expect(parseBuilderImport(bad)?.phases[0]).toMatchObject({ catalog: 'run', execMode: 'inherit', cmdArgs: null });
  });

  it('(6) the viewer reading of a saved preset invents no dependency edge for a step that states none', () => {
    const [list] = [viewerListOf([], [{ name: 'p', scope: 'global', created_by: 'studio', updated_at: 0, steps: [
      { catalog: 'produce', id: 'a' }, { catalog: 'produce', id: 'b' }, { catalog: 'review', id: 'r' },
    ] }], [])];
    expect(list![0]!.phases.map((ph) => ph.depends_on)).toEqual([[], [], []]);
  });
});
