/**
 * THE NEW JOB FORM'S GATE POSTURE, ONE FUNCTION (studio#1150, studio#1179): what the form SHOWS about the gates the
 * run will keep — power mode or phased, its posture words, the hand-off — and the launch-body keys that decide them
 * (`power`, `deliver`, `deliverGate`, `revisesPr`, and whether the run keeps the `humanConfirm` sent), from the same
 * inputs, so the two cannot disagree. The form renders `shown` and builds its body from `payload`; nothing else in
 * the form derives either.
 *
 * crew's rules this follows (`POST /runs`): a launch runs in POWER MODE when it says `power: true`, or says nothing and
 * the daemon's `powerModeDefault` is on, AND it is a repo-scoped plan or PRESET launch on an engine that runs power
 * mode; a power run drops `humanConfirm` (it asks once, at hand-off, through the deliver gate). Any other launch runs
 * phased and keeps it. A delivering launch keeps the engine's deliver gate unless the body says `deliverGate: 'auto'`
 * (only to a daemon that has the gate); a revision always delivers onto its PR.
 *
 * Wherever the form cannot know what crew would decide (the daemon's power setting not read, the presets list not
 * read), the body SAYS what the form shows (`power: false`), so the run is what was shown.
 */
import { describeGate } from '../components/launchTarget.js';
import type { ConfirmMode } from '../components/ContextPopover.js';
import type { RunMode } from '../components/runMode.js';

export type RunModeWord = RunMode | undefined;

export interface LaunchPostureInput {
  /** The composer's run mode (`ask` = gate every step, `autonomous` = no human gates). */
  mode: RunModeWord;
  confirmMode: ConfirmMode;
  beforeOrd: number;
  /** `capabilities.powerMode`: the engine runs power mode. */
  powerCap: boolean;
  /** The daemon's `powerModeDefault` once read; `null` = not read (or the read failed). */
  powerDefault: boolean | null;
  /** The person turned power mode off for this launch. */
  powerOff: boolean;
  /** A build launch (not a chat / system workflow). */
  build: boolean;
  /** The repository it works in, or null. */
  repoRef: string | null;
  /** The launch carries a composed plan. */
  plan: boolean;
  /** The workflow it names ('' = none). */
  workflow: string;
  /** Whether that workflow is one of the daemon's presets: `null` = not known (the presets list is not read). */
  isPreset: boolean | null;
  /** The "Open a PR when done" toggle. */
  deliverOn: boolean;
  /** A revision of an open PR the daemon can take (`revisesPr` will ride the body). */
  revise: boolean;
  /** `capabilities.deliverGate`: the engine keeps a deliver gate; `null` = not known (the health read failed). */
  deliverGateCap: boolean | null;
}

export type HandOff = 'gate' | 'auto' | 'none';

export interface LaunchPosture {
  shown: {
    /** The run will be a power run. */
    power: boolean;
    /** The Power mode switch is offered (only where it changes something: a power launch outside Autonomous). */
    switchShown: boolean;
    /** The power selector's value (power runs only): the hand-off as the body leaves it. */
    powerChoice: 'before' | 'none' | 'no-handoff';
    /** The power selector cannot be changed (Autonomous, or nothing delivered). */
    powerChoiceFixed: boolean;
    /** The power selector's tooltip. */
    powerTitle: string;
    /** The Ready-to-send gate words. */
    gateWords: string;
    /** The hand-off as the body leaves it. */
    handOff: HandOff;
  };
  payload: {
    /** `power` to send; `undefined` = no key (the daemon's setting, which is on, decides). */
    power: boolean | undefined;
    deliver: 'pr' | 'none' | undefined;
    deliverGate: 'auto' | undefined;
    revisesPr: boolean;
    /** The run keeps the `humanConfirm` the body sends (false on a power run, which drops it). */
    keepsHumanConfirm: boolean;
  };
}

export const POWER_GATE_WORDS = 'at hand-off (power mode)';
export const POWER_NO_GATE_WORDS = 'no gates (power mode, delivers on its own)';
export const POWER_NO_HANDOFF_WORDS = 'no gates (power mode, no hand-off)';

export function launchPosture(i: LaunchPostureInput): LaunchPosture {
  const repoScoped = i.build && i.repoRef !== null;
  const revise = i.revise && repoScoped && !i.plan;
  const deliver: 'pr' | 'none' | undefined = revise ? 'pr' : repoScoped ? (i.deliverOn ? 'pr' : 'none') : undefined;
  const autoDeliver = i.mode === 'autonomous' || (i.mode !== 'ask' && i.confirmMode === 'none');
  const deliverGate = deliver === 'pr' && autoDeliver && i.deliverGateCap === true ? 'auto' as const : undefined;
  const handOff: HandOff = deliver !== 'pr' ? 'none' : deliverGate === 'auto' || i.deliverGateCap === false ? 'auto' : 'gate';

  // Power applies only where crew runs it (a repo-scoped plan or preset launch) and the form KNOWS it does.
  const presetLaunch = i.plan || (i.workflow !== '' && i.isPreset === true);
  const powerKnown = i.powerCap && i.powerDefault === true && repoScoped && i.mode !== 'ask' && presetLaunch;
  const switchShown = powerKnown && i.mode !== 'autonomous';
  const power = powerKnown && !(i.powerOff && switchShown);
  // Not shown as power where crew might still run it (setting unread, presets unread, switched off, Ask): say so.
  const power_: boolean | undefined = power ? undefined : (i.powerCap && repoScoped ? false : undefined);

  const powerChoice = handOff === 'none' ? 'no-handoff' : handOff === 'auto' ? 'none' : 'before';
  const powerTitle = handOff === 'none'
    ? 'Nothing is delivered, so there is no hand-off to ask at'
    : handOff === 'auto'
      ? 'The job runs and delivers on its own: no gate, not even at hand-off'
      : i.mode === 'autonomous'
        ? 'The hand-off gate stays: this daemon could not be read to say it may deliver on its own'
        : 'Power mode asks you once, at hand-off, plus anything policy or the QE plan requires';
  const gateWords = power
    ? handOff === 'none' ? POWER_NO_HANDOFF_WORDS : handOff === 'auto' ? POWER_NO_GATE_WORDS : POWER_GATE_WORDS
    : describeGate(i.mode, i.confirmMode, i.beforeOrd);

  return {
    shown: {
      power, switchShown, powerChoice, powerChoiceFixed: i.mode === 'autonomous' || handOff === 'none',
      powerTitle, gateWords, handOff,
    },
    payload: { power: power_, deliver, deliverGate, revisesPr: revise, keepsHumanConfirm: !power },
  };
}
