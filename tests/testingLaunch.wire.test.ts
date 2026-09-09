import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, isRouteAbsent } from '../src/api/errors.js';

/**
 * The testing LAUNCH wire, below the panel — T1–T4 of the Tests-feature plan
 * (docs/testing/tests-feature-test-plan.md): the pure folds and the presence gate of
 * `launchTestingRun`, with `apiFetch` mocked at the client boundary.
 *
 * T4's point is the NEGATIVE guarantee: a REAL refusal — a named 404, a validation 400, a 500 or
 * 501, a transport failure — is rethrown untouched and NEVER retried over `POST /runs`. Only the
 * bare unknown-route 404 (both spellings) falls back, and only for a scope that fits the legacy
 * single-`repoRef` wire; a scope that needs the pinned fields is the honest named gap.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

const {
  isMultiScopeUnsupported, launchTestingRun, launchedRunIds, MultiScopeUnsupportedError,
} = await import('../src/api/testing.js');

/** Fastify's headless default and crew's SPA-serving notFoundHandler — the two route-absent bodies. */
const ROUTE_ABSENT_SPELLINGS = ['Not Found', 'not found'] as const;

/** The paths `apiFetch` was asked for, in call order. */
const paths = (): string[] => apiFetch.mock.calls.map(([p]) => String(p));

/** The parsed JSON body of the ONE POST to `path`. */
function bodySentTo(path: string): Record<string, unknown> {
  const calls = apiFetch.mock.calls.filter(([p]) => String(p) === path);
  expect(calls).toHaveLength(1);
  const init = calls[0]![1] as { method?: string; body?: string };
  expect(init.method).toBe('POST');
  // A POST without a body is a regression in its own right — name it here, rather than letting
  // `JSON.parse(null)` surface later as an opaque TypeError on the parsed object.
  expect(init.body, `${path} was POSTed without a body`).toBeTypeOf('string');
  return JSON.parse(init.body!) as Record<string, unknown>;
}

/** An old-crew wire: `/testing/recon` is absent (spelled `wire`), `/runs` answers `runsAnswer`. */
function oldCrew(wire: string, runsAnswer: unknown | Error): void {
  apiFetch.mockImplementation((path: unknown) => {
    if (String(path) === '/runs') {
      return runsAnswer instanceof Error ? Promise.reject(runsAnswer) : Promise.resolve(runsAnswer);
    }
    return Promise.reject(new ApiError(404, wire));
  });
}

beforeEach(() => {
  apiFetch.mockReset();
});

describe('T1 — isRouteAbsent: the bare unknown-route 404, both spellings, nothing else', () => {
  it('T1 — matches exactly the two route-absent bodies', () => {
    for (const wire of ROUTE_ABSENT_SPELLINGS) {
      expect(isRouteAbsent(new ApiError(404, wire))).toBe(true);
    }
  });

  it('T1 — a NAMED 404 is a real answer from a daemon WITH the route', () => {
    expect(isRouteAbsent(new ApiError(404, 'unknown campaign: x'))).toBe(false);
    expect(isRouteAbsent(new ApiError(404, 'unknown project: proj-a'))).toBe(false);
  });

  it('T1 — the spelling is exact, the status must be 404, and non-wire errors never match', () => {
    expect(isRouteAbsent(new ApiError(404, 'NOT FOUND'))).toBe(false);
    expect(isRouteAbsent(new ApiError(404, ''))).toBe(false);
    expect(isRouteAbsent(new ApiError(500, ''))).toBe(false);
    expect(isRouteAbsent(new ApiError(400, 'Not Found'))).toBe(false);
    expect(isRouteAbsent(new Error('Not Found'))).toBe(false);
    expect(isRouteAbsent(undefined)).toBe(false);
  });
});

describe('T2 — launchedRunIds: runIds (≥ 1 non-empty string) wins; else the legacy runId; else nothing', () => {
  it('T2 — the recon answer: runIds is the source of truth even when runId disagrees', () => {
    expect(launchedRunIds({ runIds: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(launchedRunIds({ runId: 'z', runIds: ['a', 'b'], campaign: 'suite-1' })).toEqual(['a', 'b']);
  });

  it('T2 — an empty or all-invalid runIds falls back to runId; nothing usable is []', () => {
    expect(launchedRunIds({ runIds: [], runId: 'a' })).toEqual(['a']);
    expect(launchedRunIds({ runIds: ['', ''], runId: 'a' })).toEqual(['a']);
    expect(launchedRunIds({ runId: 'a' })).toEqual(['a']);
    expect(launchedRunIds({ runIds: [] })).toEqual([]);
    expect(launchedRunIds({ runId: '' })).toEqual([]);
    expect(launchedRunIds({})).toEqual([]);
  });

  it('T2 — invalid entries are dropped, never rendered as links', () => {
    expect(launchedRunIds({ runIds: ['', 3, null, 'ok'] } as never)).toEqual(['ok']);
    expect(launchedRunIds({ runIds: 'a' } as never)).toEqual([]);
    expect(launchedRunIds({ runId: 3 } as never)).toEqual([]);
  });
});

describe('T3 — isMultiScopeUnsupported: THIS daemon cannot serve a multi-codebase launch', () => {
  it('T3 — the primary signal is the fold\'s own MultiScopeUnsupportedError', () => {
    expect(isMultiScopeUnsupported(new MultiScopeUnsupportedError())).toBe(true);
  });

  it('T3 — belt-and-braces: a strict launch zod refusing the pinned keys BY NAME (400)', () => {
    expect(isMultiScopeUnsupported(new ApiError(400, "Unrecognized key(s) in object: 'repoRefs'"))).toBe(true);
    expect(isMultiScopeUnsupported(new ApiError(400, 'unrecognized key projectId'))).toBe(true);
  });

  it('T3 — a named 400 about anything else is a REAL answer; other statuses and non-wire errors never match', () => {
    expect(isMultiScopeUnsupported(new ApiError(400, 'project proj-a holds zero repos — attach one first'))).toBe(false);
    expect(isMultiScopeUnsupported(new ApiError(400, "repoRefs: 'r-9' does not name a registered repo"))).toBe(false);
    // Route absence is the launch fold's business (it throws the typed error above), not this predicate's.
    expect(isMultiScopeUnsupported(new ApiError(404, 'Not Found'))).toBe(false);
    expect(isMultiScopeUnsupported(new ApiError(500, 'unrecognized key'))).toBe(false);
    expect(isMultiScopeUnsupported(new Error('unrecognized key repoRefs'))).toBe(false);
  });
});

describe('T4 — launchTestingRun: the presence gate on POST /testing/recon', () => {
  it('T4a — 200 on the pinned route answers verbatim; /runs is never touched', async () => {
    const answer = { runId: 'a', runIds: ['a', 'b'], campaign: 'suite-1', extra: 'passes through untouched' };
    apiFetch.mockResolvedValue(answer);
    const body = { problem: 'p', projectId: 'proj-a', repoRefs: ['r-1'] };

    await expect(launchTestingRun(body)).resolves.toEqual(answer);
    expect(paths()).toEqual(['/testing/recon']);
    expect(bodySentTo('/testing/recon')).toEqual(body);
  });

  it.each(ROUTE_ABSENT_SPELLINGS)(
    'T4b — route absent (%j) + a PROJECT scope → MultiScopeUnsupportedError; /runs is never tried',
    async (wire) => {
      oldCrew(wire, { runId: 'never-launched' });
      await expect(launchTestingRun({ problem: 'p', projectId: 'proj-a' })).rejects.toBeInstanceOf(MultiScopeUnsupportedError);
      expect(paths()).toEqual(['/testing/recon']);
    },
  );

  it.each(ROUTE_ABSENT_SPELLINGS)(
    'T4c — route absent (%j) + ONE repo → POST /runs {problem, repoRef}: the legacy spelling, no pinned key',
    async (wire) => {
      oldCrew(wire, { runId: 'run-old' });
      await expect(launchTestingRun({ problem: 'p', repoRefs: ['r-1'] })).resolves.toEqual({ runId: 'run-old' });
      expect(paths()).toEqual(['/testing/recon', '/runs']);
      const legacy = bodySentTo('/runs');
      expect(legacy).toEqual({ problem: 'p', repoRef: 'r-1' });
      // The old strict zod 400s on `repoRefs`/`projectId` — neither may ride the fallback.
      expect(Object.keys(legacy)).toEqual(['problem', 'repoRef']);
    },
  );

  it('T4c — route absent + UNSCOPED (absent or empty repoRefs) → POST /runs {problem} alone', async () => {
    oldCrew('not found', { runId: 'run-old' });
    await launchTestingRun({ problem: 'p' });
    expect(bodySentTo('/runs')).toEqual({ problem: 'p' });

    apiFetch.mockClear();
    oldCrew('not found', { runId: 'run-old' });
    await launchTestingRun({ problem: 'p', repoRefs: [] });
    expect(bodySentTo('/runs')).toEqual({ problem: 'p' });
  });

  it('T4d — route absent + TWO repos → MultiScopeUnsupportedError; never half a scope over /runs', async () => {
    oldCrew('Not Found', { runId: 'never-launched' });
    await expect(launchTestingRun({ problem: 'p', repoRefs: ['r-1', 'r-2'] })).rejects.toBeInstanceOf(MultiScopeUnsupportedError);
    expect(paths()).toEqual(['/testing/recon']);
  });

  const REFUSALS: Array<[string, unknown]> = [
    ['a NAMED 404 (unknown project)', new ApiError(404, 'unknown project: proj-a')],
    ['a validation 400 (bad ref)', new ApiError(400, "repoRefs: 'r-9' does not name a registered repo")],
    ['a strict-zod 400 (unrecognized key)', new ApiError(400, "Unrecognized key(s) in object: 'repoRefs'")],
    ['a 500', new ApiError(500, 'internal error')],
    ['a 501 (route present, engine absent)', new ApiError(501, 'the embedded engine predates recon')],
    ['a transport failure', new TypeError('Failed to fetch')],
  ];

  it.each(REFUSALS)(
    'T4 negative — %s is rethrown AS-IS after one call; /runs is never a fallback for a real answer',
    async (_label, refusal) => {
      apiFetch.mockRejectedValue(refusal);
      // A one-repo scope — the one that WOULD fall back on route absence — proves the gate
      // discriminates on the refusal, not on the scope.
      await expect(launchTestingRun({ problem: 'p', repoRefs: ['r-1'] })).rejects.toBe(refusal);
      expect(paths()).toEqual(['/testing/recon']);
    },
  );

  it('T4 — a fallback that itself fails propagates THAT refusal verbatim, never re-read as route absence', async () => {
    const refusal = new ApiError(400, 'problem: must not be empty');
    oldCrew('Not Found', refusal);
    await expect(launchTestingRun({ problem: '', repoRefs: ['r-1'] })).rejects.toBe(refusal);
    expect(paths()).toEqual(['/testing/recon', '/runs']);
  });
});
