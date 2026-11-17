/**
 * studio#1150: the New job form's ONE read-only line about power mode, derived from the launch body the form sends and
 * what the daemon has said — it changes nothing the form sends.
 *
 * crew (`POST /runs`) runs a launch in POWER MODE when the body says `power: true`, or says nothing and the daemon's
 * `powerModeDefault` is on, AND the launch is a repo-scoped plan or PRESET launch on an engine that runs power mode. A
 * power run drops the body's `humanConfirm`: it asks once, at hand-off (the deliver gate). The form's posture and its
 * "gate:" words describe the phased run; this line says, plainly, when that posture will not be kept.
 */

/** The wire keys the line reads, as the launch body carries them. */
export interface PowerNoticeBody {
  repoRef?: string;
  workflow?: string;
  plan?: unknown;
  humanConfirm?: string;
  power?: boolean;
  deliver?: 'pr' | 'none';
  deliverGate?: 'auto';
}

export interface PowerNoticeDaemon {
  /** `capabilities.powerMode`. */
  powerMode: boolean;
  /** `powerModeDefault` once read; `null` = not read. */
  powerDefault: boolean | null;
  /** Whether the body's workflow is one of the daemon's presets; `null` = the presets list is not read. */
  isPreset: boolean | null;
}

export const POWER_WILL_DROP = 'This runs in power mode: it asks you once, at hand-off, and the step gates above are not kept. Turn power mode off in Settings to keep them.';
export const POWER_MAY_DROP = 'If this runs in power mode (Settings), it asks you once, at hand-off, and the step gates above are not kept.';
/** …when the body hands nothing over for a person to approve (no PR, or `deliverGate: 'auto'`): no hand-off to ask at. */
export const POWER_WILL_DROP_NO_HANDOFF = 'This runs in power mode: the step gates above are not kept, and it does not stop for you. Turn power mode off in Settings to keep them.';
export const POWER_MAY_DROP_NO_HANDOFF = 'If this runs in power mode (Settings), the step gates above are not kept, and it does not stop for you.';

/** The line, or `null` when the body's step gates are what the run keeps (or it sends none). */
export function powerNotice(body: PowerNoticeBody, daemon: PowerNoticeDaemon): string | null {
  if (!daemon.powerMode || body.repoRef === undefined || body.power === false) return null;
  if (body.humanConfirm === undefined || body.humanConfirm === 'none') return null;
  const preset: boolean | null = body.plan !== undefined ? true : body.workflow === undefined ? false : daemon.isPreset;
  if (preset === false) return null;
  const on: boolean | null = body.power === true ? true : daemon.powerDefault;
  if (on === false) return null;
  // A power run's one stop is the deliver gate: only a body that delivers and keeps that gate asks at hand-off.
  const handOff = body.deliver === 'pr' && body.deliverGate !== 'auto';
  const sure = on === true && preset === true;
  return handOff ? (sure ? POWER_WILL_DROP : POWER_MAY_DROP) : (sure ? POWER_WILL_DROP_NO_HANDOFF : POWER_MAY_DROP_NO_HANDOFF);
}

/**
 * The launch body's delivery keys, exactly as the New job form sets them (one function for the body and for the line
 * above, so the line reads the body it describes): `deliver` for a repo-scoped build launch from the toggle, the
 * unattended opt-out `deliverGate: 'auto'` decided on that toggle's `deliver`, and a revision forcing `deliver: 'pr'`.
 */
export function launchDeliveryKeys(i: {
  build: boolean;
  repoRef: string | null;
  deliverOn: boolean;
  autoDeliver: boolean;
  daemonDeliverGate: boolean | null;
  revise: boolean;
  plan: boolean;
}): { deliver?: 'pr' | 'none'; deliverGate?: 'auto'; revisesPr: boolean } {
  const out: { deliver?: 'pr' | 'none'; deliverGate?: 'auto'; revisesPr: boolean } = { revisesPr: false };
  if (i.build && i.repoRef !== null) out.deliver = i.deliverOn ? 'pr' : 'none';
  if (out.deliver === 'pr' && i.autoDeliver && i.daemonDeliverGate === true) out.deliverGate = 'auto';
  if (i.revise && i.repoRef !== null && !i.plan) {
    out.revisesPr = true;
    out.deliver = 'pr';
  }
  return out;
}
