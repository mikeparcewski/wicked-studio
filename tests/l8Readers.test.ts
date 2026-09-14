// fixall L8-8E(ii)/(iv) + the run clock — pure readers: `api.getRunDiff` sends `base=merge-base`
// (studio #244; BC-54), `runWhenWord` prefers the run's own `created_at` and `runEndedWord` never
// derives a duration for an undated run (crew #496 / studio #230; BC-52), and the workflow builder
// round-trips `skill_ref` / `allowed_skills` / `required_deliverables` / `validator_pin` (F-RC1-093).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { runEndedWord, runWhenWord } from '../src/components/runIdentity.js';
import { buildDef, builderPhaseOf } from '../src/components/WorkflowViewer.js';
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

describe('workflow builder round-trip (F-RC1-093)', () => {
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

  it('builderPhaseOf carries the four fields; buildDef writes them back verbatim (was: nulled on every save)', async () => {
    const built = await buildDef(def.id, def.phases.map(builderPhaseOf));
    expect(built.id).toBe('capture-learnings');
    expect(built.phases.map((p) => [p.id, p.skill_ref, p.allowed_skills, p.required_deliverables, p.validator_pin])).toEqual([
      ['churn', 'wicked-garden-repo-learn', ['wicked-garden-search'], ['NOTES.md'], 'wicked-validator:evidence-floor@1'],
      ['hotspots', 'wicked-garden-repo-learn', ['wicked-garden-search'], ['NOTES.md'], 'wicked-validator:evidence-floor@1'],
    ]);
    // the tool executor survives the trip too
    expect(built.phases[1]!.executor).toEqual({ type: 'tool', cmd: ['echo', 'hi'] });
    expect(built.phases[0]!.executor).toEqual({ type: 'agent' });
  });

  it('a def without the fields (older shape) still builds — null / [] defaults, never undefined', async () => {
    const bare = { ...phase } as Partial<PhaseDef> as PhaseDef;
    delete (bare as Partial<PhaseDef>).skill_ref;
    delete (bare as Partial<PhaseDef>).allowed_skills;
    delete (bare as Partial<PhaseDef>).required_deliverables;
    delete (bare as Partial<PhaseDef>).validator_pin;
    const built = await buildDef('x', [builderPhaseOf(bare)]);
    expect(built.phases[0]).toMatchObject({ skill_ref: null, allowed_skills: [], required_deliverables: [], validator_pin: null });
  });
});
