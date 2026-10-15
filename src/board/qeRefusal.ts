import { ApiError } from '../api/errors.js';

/**
 * A refusal BECAUSE QE acceptance is required, and what the person can do about it (operator ask,
 * 2026-10-14: "a warning in the UI if it fails for QE acceptance — you can turn it off, with the
 * link to Settings").
 *
 * crew names these refusals with one stable token, `code: 'qe_acceptance_required'`:
 *  - a refused DELIVERY (409 `QeAcceptanceRefusal`, crew ≥ 0.9.0): an approve of the deliver gate
 *    (`POST /runs/:id/gate`, a gated resume or reassign) or a post-hoc `POST /runs/:id/deliver`;
 *  - a refused LAUNCH (400 on `POST /runs` with `deliverGate: 'auto'`, crew ≥ 0.12.1). An older crew
 *    sends only the sentence, matched here on both of its fixed parts and nothing looser.
 *
 * Turning the setting off changes LAUNCHES only: a run's QE decision is fixed when it starts (crew
 * reads `session.assurance.qe`), so a refused delivery is told that the switch helps the jobs started
 * after it. The words are for the person on screen; nothing here is handed to a helper.
 */
export const QE_ACCEPTANCE_REQUIRED_CODE = 'qe_acceptance_required';

/** The anchor of Settings' "Require QE acceptance before delivery" switch. */
export const QE_SETTING_ANCHOR = 'qe-acceptance';
/** The address that lands on that switch. */
export const QE_SETTING_PATH = `/system#${QE_SETTING_ANCHOR}`;

export type QeRefusalKind = 'launch' | 'delivery';

/** crew ≤ 0.12.0's launch sentence (routes.ts, EX-03 at launch): both fixed parts must be present. */
const LEGACY_LAUNCH_QE = /requires QE acceptance \(required_instruments: qe_acceptance\)/;
const LEGACY_LAUNCH_AUTO = /deliverGate: "auto" cannot apply/;

function codeOf(e: ApiError): string | null {
  const body = e.body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as Record<string, unknown>)['code'];
  return typeof code === 'string' ? code : null;
}

/** Which QE acceptance refusal `e` is, or `null` when it is not one. */
export function qeRefusalOf(e: unknown): QeRefusalKind | null {
  if (!(e instanceof ApiError)) return null;
  const code = codeOf(e);
  if (e.status === 409) return code === QE_ACCEPTANCE_REQUIRED_CODE ? 'delivery' : null;
  if (e.status === 400) {
    if (code === QE_ACCEPTANCE_REQUIRED_CODE) return 'launch';
    if (code === null && LEGACY_LAUNCH_QE.test(e.wire) && LEGACY_LAUNCH_AUTO.test(e.wire)) return 'launch';
  }
  return null;
}

/** The daemon's QE acceptance setting as last read; `null` = not reported (an older daemon) or unread. */
export type QeSetting = 'required' | 'off' | null;

export interface QeRefusalWords {
  /** What failed, and why — always said. */
  title: string;
  body: string;
  /** What the person can do, given the setting. */
  fix: string;
  /** Offer the link to the Settings switch (only when the switch would change something). */
  link: boolean;
}

/** The link's words. */
export const QE_SETTING_LINK = 'Open the QE acceptance setting';
/** The short form (toast, approvals bar), when the service reports QE acceptance required. */
export const QE_REQUIRED_OFFER = 'QE acceptance can be turned off for jobs started later.';
/** The short form when it is already off. */
export const QE_OFF_OFFER = 'QE acceptance is off, but this job keeps the requirement it started with.';

/**
 * The warning's words. `forced`: the launch itself asked to require QE acceptance (`forceQeAcceptance`),
 * which the setting cannot override.
 */
export function qeRefusalWords(kind: QeRefusalKind, setting: QeSetting, opts: { forced?: boolean } = {}): QeRefusalWords {
  if (kind === 'launch') {
    const title = 'Not started: this job needs QE acceptance';
    const body = 'Its workflow waits for a QE acceptance pass before it delivers, so it can’t push without asking you first. Nothing was started.';
    if (opts.forced === true) {
      return { title, body, fix: 'You asked this job to require QE acceptance. Untick that, or let the job ask you before it pushes.', link: false };
    }
    if (setting === 'required') {
      return { title, body, fix: 'Let the job ask you before it pushes, or turn off QE acceptance in Settings.', link: true };
    }
    if (setting === 'off') {
      return { title, body, fix: 'QE acceptance is off on this computer now, so starting the job again should work.', link: false };
    }
    return { title, body, fix: 'Let the job ask you before it pushes.', link: false };
  }
  const title = 'Not delivered: QE acceptance hasn’t passed';
  const body = 'This job needs a QE acceptance pass before it delivers. Nothing was pushed.';
  return { title, body, ...qeDeliveryFix(setting) };
}

/** What a job held back by QE acceptance can do (a refused delivery, or a hand-over that would be). */
export function qeDeliveryFix(setting: QeSetting): { fix: string; link: boolean } {
  if (setting === 'required') {
    return {
      fix: 'You can turn off QE acceptance in Settings. It applies to jobs started after that, so start this job again to deliver it without the check.',
      link: true,
    };
  }
  if (setting === 'off') {
    return {
      fix: 'QE acceptance is off on this computer, but this job keeps the QE requirement it started with, so it still needs a pass. Record a QE pass for it, or start the job again without requiring QE acceptance.',
      link: false,
    };
  }
  return { fix: 'Record a QE pass for this job, then try again.', link: false };
}
