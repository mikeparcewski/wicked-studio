import { describe, it, expect } from 'vitest';
import { launchPosture, type LaunchPostureInput } from '../src/board/launchPosture.js';

/**
 * studio#1150 / #1179: EVERY combination of the form's inputs. For each, what the form SHOWS (power or phased, the
 * step gates, the hand-off) must be what the run does with the body it SENDS — the run's behaviour modelled from
 * crew's `POST /runs` rules (packages/crew/src/api/routes.ts, the power launch block, and the engine's deliver gate):
 *  - power when the body says `power: true`, or says nothing and the daemon's setting is on, AND it is a repo-scoped
 *    plan or preset launch on an engine that runs power mode; a power run drops `humanConfirm`;
 *  - Autonomous sends no `humanConfirm`; Ask sends "every unit";
 *  - a delivering launch keeps the deliver gate unless the body says `deliverGate: 'auto'` (a daemon without the gate
 *    has none to keep).
 * The daemon's TRUE setting and preset membership may differ from what the form has read (unread, failed, stale
 * unknown): the run must still be what the form showed.
 */
const bools = [true, false] as const;
const modes = ['balanced', 'autonomous', 'ask', undefined] as const;
const confirms = ['before', 'all', 'none'] as const;

interface Run { power: boolean; stepGates: 'none' | 'before' | 'all'; handOff: 'gate' | 'auto' | 'none' }

function crewRuns(i: LaunchPostureInput, p: ReturnType<typeof launchPosture>['payload'], truth: { setting: boolean; preset: boolean }): Run {
  const repoScoped = i.build && i.repoRef !== null;
  const presetLaunch = i.plan || (i.workflow !== '' && truth.preset);
  const power = i.powerCap && repoScoped && presetLaunch && (p.power ?? truth.setting);
  // What the body's humanConfirm asks for (Autonomous: none sent; Ask: every unit).
  // The humanConfirm the body sends (none at all when the form says it is not kept).
  const asked: Run['stepGates'] = !p.keepsHumanConfirm || i.mode === 'autonomous' ? 'none' : i.mode === 'ask' ? 'all' : i.confirmMode;
  const handOff: Run['handOff'] = p.deliver !== 'pr' ? 'none'
    : p.deliverGate === 'auto' || i.deliverGateCap === false ? 'auto' : 'gate';
  return { power, stepGates: power ? 'none' : asked, handOff };
}

function shownRun(i: LaunchPostureInput, s: ReturnType<typeof launchPosture>['shown']): Run {
  const asked: Run['stepGates'] = i.mode === 'autonomous' ? 'none' : i.mode === 'ask' ? 'all' : i.confirmMode;
  return { power: s.power, stepGates: s.power ? 'none' : asked, handOff: s.handOff };
}

describe('launchPosture: what the form shows is what the run does (studio#1150, #1179)', () => {
  it('every combination', () => {
    let n = 0;
    for (const mode of modes) for (const confirmMode of confirms) for (const powerCap of bools)
    for (const powerDefault of [true, false, null] as const) for (const powerOff of bools)
    for (const plan of bools) for (const isPreset of [true, false, null] as const) for (const revise of bools)
    for (const deliverOn of bools) for (const deliverGateCap of [true, false, null] as const) for (const repo of bools) {
      const i: LaunchPostureInput = {
        mode, confirmMode, beforeOrd: 1, powerCap, powerDefault, powerOff, build: true, repoRef: repo ? 'r' : null,
        plan, workflow: plan ? '' : 'feature', isPreset, deliverOn, revise, deliverGateCap,
      };
      const out = launchPosture(i);
      // The daemon's truth: what the form read when it read it; anything when it did not.
      const settings = powerDefault === null ? bools : [powerDefault];
      const presetTruths = isPreset === null ? bools : [isPreset];
      for (const setting of settings) for (const preset of presetTruths) {
        const label = JSON.stringify({ ...i, setting, preset });
        expect(crewRuns(i, out.payload, { setting, preset }), label).toEqual(shownRun(i, out.shown));
        // The words say the same: power words only for a power run, and the hand-off they name is the body's.
        if (out.shown.power) {
          expect(out.shown.gateWords, label).toMatch(out.shown.handOff === 'none' ? /no hand-off/ : out.shown.handOff === 'auto' ? /delivers on its own/ : /at hand-off/);
          expect(out.payload.keepsHumanConfirm, label).toBe(false);
        } else {
          expect(out.shown.gateWords, label).not.toMatch(/power mode/);
          expect(out.payload.keepsHumanConfirm, label).toBe(true);
        }
        // The power selector's choice is the hand-off the body leaves.
        expect({ before: 'gate', none: 'auto', 'no-handoff': 'none' }[out.shown.powerChoice], label).toBe(out.shown.handOff);
        n++;
      }
    }
    expect(n).toBeGreaterThan(10_000);
  });

  it('a registered workflow that is not a preset is never shown as power, and the body says so (codex-check 1176b)', () => {
    const out = launchPosture({ mode: 'balanced', confirmMode: 'before', beforeOrd: 1, powerCap: true, powerDefault: true, powerOff: false,
      build: true, repoRef: 'r', plan: false, workflow: 'my-def', isPreset: false, deliverOn: true, revise: false, deliverGateCap: true });
    expect(out.shown.power).toBe(false);
    expect(out.shown.gateWords).toBe('first gate');
    expect(out.payload).toMatchObject({ power: false, keepsHumanConfirm: true });
  });
});
