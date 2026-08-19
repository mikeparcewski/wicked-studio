// Unit tests for the merged preflight / install-gate readiness model — slice 17.
//
// Four folded states carry the design's rules (§5.6, §4.9, §1.3 rule 3):
//   · bridge down            → no gate (retrying fixes it; the surface names the fix),
//                              but the mode states what enables it;
//   · hard dep missing       → the gate, with the SERVICE's command verbatim;
//   · optional dep missing   → nothing at all — ffmpeg/python-pptx degrade at point-of-use;
//   · all green              → nothing at all.
// Plus: Chat/Build are never gated, and "Continue anyway" lasts the session.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  UNKNOWN_READINESS,
  enablingAction,
  gateBlockers,
  gateForMode,
  normalizeDeps,
  useReadinessStore,
  type ProjectReadiness,
} from '../src/store/readiness.js';

const GARDEN_HINT = 'npm i -g wicked-garden';
const FFMPEG_HINT = 'brew install ffmpeg';
const BRIDGE_HINT = 'run `npx wicked-interactive serve` in this project’s root';

function readiness(over: Partial<ProjectReadiness> = {}): ProjectReadiness {
  return { ...UNKNOWN_READINESS, bridge: 'ready', ...over };
}

const ALL_GREEN = readiness({
  deps: normalizeDeps({ deps: { garden: { ok: true }, ffmpeg: { ok: true }, 'python-pptx': { ok: true } } }),
});
const GARDEN_MISSING = readiness({
  deps: normalizeDeps({
    deps: {
      garden: { ok: false, install: GARDEN_HINT },
      ffmpeg: { ok: true },
      'python-pptx': { ok: true },
    },
  }),
});
const FFMPEG_ONLY = readiness({
  deps: normalizeDeps({
    deps: {
      garden: { ok: true },
      ffmpeg: { ok: false, install: FFMPEG_HINT },
      'python-pptx': { ok: false, install: 'pip install python-pptx' },
    },
  }),
});
const BRIDGE_DOWN = readiness({ bridge: 'unavailable', bridgeHint: BRIDGE_HINT });

describe('normalizeDeps — the service owns the vocabulary (§5.6)', () => {
  it('reads a deps map, keeping the install command verbatim', () => {
    expect(normalizeDeps({ deps: { garden: { ok: false, install: GARDEN_HINT } } })).toEqual([
      { name: 'garden', ok: false, install: GARDEN_HINT, hard: true },
    ]);
  });

  it('reads a deps ARRAY and a top-level map the same way', () => {
    const fromArray = normalizeDeps({ deps: [{ name: 'ffmpeg', ok: false, hint: FFMPEG_HINT }] });
    const fromTopLevel = normalizeDeps({ ffmpeg: { installed: false, command: FFMPEG_HINT } });
    expect(fromArray).toEqual([{ name: 'ffmpeg', ok: false, install: FFMPEG_HINT, hard: false }]);
    expect(fromTopLevel).toEqual(fromArray);
  });

  it("takes the service's own required/optional flag over studio's default list", () => {
    expect(normalizeDeps({ deps: { garden: { ok: false, optional: true } } })[0]?.hard).toBe(false);
    expect(normalizeDeps({ deps: { chromium: { ok: false, required: true } } })[0]?.hard).toBe(true);
  });

  it('never invents a gate out of an unreadable body', () => {
    expect(normalizeDeps(null)).toEqual([]);
    expect(normalizeDeps('nope')).toEqual([]);
    expect(normalizeDeps({ deps: { garden: 'present' } })).toEqual([]);
    // A dep whose state we cannot parse reports OK: a false gate blocks a working install.
    expect(normalizeDeps({ deps: { garden: { install: GARDEN_HINT } } })[0]?.ok).toBe(true);
  });
});

describe('folding the three legs into one gate (§5.6)', () => {
  it('all green: nothing blocks and no mode states an action', () => {
    expect(gateBlockers(ALL_GREEN, true)).toEqual([]);
    expect(enablingAction('document', ALL_GREEN, true)).toBeNull();
    expect(enablingAction('video', ALL_GREEN, true)).toBeNull();
  });

  it('a missing HARD dep blocks, carrying the install command verbatim', () => {
    expect(gateBlockers(GARDEN_MISSING, true)).toEqual([{ subject: 'garden', install: GARDEN_HINT }]);
    expect(enablingAction('document', GARDEN_MISSING, true)).toContain(GARDEN_HINT);
  });

  it('missing OPTIONAL deps never gate — they degrade at point-of-use (§4.5, §4.4)', () => {
    expect(gateBlockers(FFMPEG_ONLY, true)).toEqual([]);
    expect(enablingAction('video', FFMPEG_ONLY, true)).toBeNull();
    expect(enablingAction('document', FFMPEG_ONLY, true)).toBeNull();
  });

  it('a bridge that cannot start states its named fix but does NOT take the surface', () => {
    // Retrying is what fixes it (crew starts the bridge on the next proxied request), and
    // the mode surface already shows this hint with a Retry beside it (slice 8).
    expect(gateBlockers(BRIDGE_DOWN, true)).toEqual([]);
    expect(enablingAction('document', BRIDGE_DOWN, true)).toBe(BRIDGE_HINT);
  });

  it('claims nothing while preflight is unknown or the daemon is unreachable', () => {
    expect(gateBlockers(UNKNOWN_READINESS, true)).toEqual([]);
    expect(enablingAction('document', UNKNOWN_READINESS, true)).toBeNull();
    // Crew unreachable: preflight cannot be known, so the gate must not claim it was.
    expect(gateBlockers(GARDEN_MISSING, false)).toEqual([]);
    expect(enablingAction('document', BRIDGE_DOWN, false)).toBeNull();
  });
});

describe('blocking per mode (§1.3: Chat and Build are never gated)', () => {
  it('gates only Document and Video, even with a hard dep missing', () => {
    expect(gateForMode('chat', GARDEN_MISSING, true)).toEqual([]);
    expect(gateForMode('build', GARDEN_MISSING, true)).toEqual([]);
    expect(gateForMode('document', GARDEN_MISSING, true)).toHaveLength(1);
    expect(gateForMode('video', GARDEN_MISSING, true)).toHaveLength(1);
  });

  it('never disables Chat or Build in the switcher either', () => {
    expect(enablingAction('chat', BRIDGE_DOWN, true)).toBeNull();
    expect(enablingAction('build', GARDEN_MISSING, true)).toBeNull();
  });
});

describe('the store: Continue anyway lasts the session (§4.9)', () => {
  beforeEach(() => useReadinessStore.setState({ byProject: {}, attempt: 0 }));

  const read = (id: string): ProjectReadiness =>
    useReadinessStore.getState().byProject[id] ?? UNKNOWN_READINESS;

  it('reports preflight per project and gates on that project alone', () => {
    const { report } = useReadinessStore.getState();
    report('p1', { bridge: 'ready', deps: GARDEN_MISSING.deps });
    report('p2', { bridge: 'ready', deps: ALL_GREEN.deps });
    expect(gateForMode('document', read('p1'), true)).toHaveLength(1);
    expect(gateForMode('document', read('p2'), true)).toEqual([]);
  });

  it('continuing unblocks that project, and only that project', () => {
    const { report, continueAnyway } = useReadinessStore.getState();
    report('p1', { bridge: 'ready', deps: GARDEN_MISSING.deps });
    report('p2', { bridge: 'ready', deps: GARDEN_MISSING.deps });
    continueAnyway('p1');
    expect(gateForMode('document', read('p1'), true)).toEqual([]);
    expect(enablingAction('document', read('p1'), true)).toBeNull();
    expect(gateForMode('document', read('p2'), true)).toHaveLength(1);
  });

  it('survives a re-check that still reports the dependency missing', () => {
    const { report, continueAnyway, recheck } = useReadinessStore.getState();
    report('p1', { bridge: 'ready', deps: GARDEN_MISSING.deps });
    continueAnyway('p1');
    recheck();
    report('p1', { bridge: 'ready', deps: GARDEN_MISSING.deps });
    expect(read('p1').continued).toBe(true);
    expect(gateForMode('document', read('p1'), true)).toEqual([]);
    expect(useReadinessStore.getState().attempt).toBe(1);
  });
});
