/**
 * (studio#1150) The New job form's human gates come from crew, not from a model of crew's rules.
 *
 * crew decides a launch's posture in ONE function (`core/launch-posture.ts`) — power mode, the
 * `humanConfirm` the engine keeps, delivery and its gate — and answers it for a body at
 * `POST /runs/preview` (the crew release carrying api-types 0.212.0). The form previews the fields of the body
 * it will send ({@link launchPostureFields}, the same function `submit` builds them with), shows the
 * answer, and sends `power` as that answer said for that same body ({@link powerToSend}): the
 * daemon's setting can then not change the run between what was shown and what runs. No answer for
 * the body being sent — loading, failed, an older daemon — shows nothing about power and sends
 * `power: false`, so the run is the phased one the step-gate select describes.
 *
 * studio#1176 modelled crew's rules here and drifted six times; nothing here re-derives one.
 */
import type { LaunchPlan } from '../api/teamPlan.js';

/** `POST /runs/preview`'s body (api-types 0.212.0 `LaunchPreviewBody`). */
export interface LaunchPreviewBody {
  power?: boolean;
  repoRef?: string;
  workflow?: string;
  plan?: LaunchPlan;
  projectId?: string;
  humanConfirm?: string;
  deliver?: 'pr' | 'none';
  deliverGate?: 'human' | 'auto';
}

/** api-types 0.212.0 `LaunchPreviewPosture`: crew's decision for the body. */
export interface LaunchPreviewPosture {
  power: boolean;
  humanConfirm?: string;
  deliver: 'pr' | 'none';
  autoDeliver: boolean;
  powerNotice?: string;
  humanConfirmNotice?: string;
}

/** The body fields that decide the run's gates, as the form sends them. */
export interface LaunchPostureFields {
  workflow?: string;
  plan?: LaunchPlan;
  repoRef?: string;
  projectId?: string;
  deliver?: 'pr' | 'none';
  deliverGate?: 'auto';
}

export interface PostureFormState {
  /** `build` launches dispatch workers into a repo; only they carry `deliver`. */
  launchKind: string;
  plan: LaunchPlan | null;
  workflow: string;
  repoRef: string | null;
  projectId: string | null;
  /** The "Open a PR" toggle. */
  deliverOn: boolean;
  /** The unattended postures (Autonomous, or "Never") opt out of the deliver gate. */
  autoDeliver: boolean;
  /** `capabilities.deliverGate`: `true` only when the daemon keeps the deliver gate. */
  daemonDeliverGate: boolean | null;
  /** The launch revises an open PR (and the daemon takes `revisesPr`): always a PR delivery. */
  revising: boolean;
}

/**
 * The gate-deciding fields of the launch body, built ONCE for both the preview and `submit`.
 * (Order kept from main: the deliver gate is decided on the toggle's delivery, before a revision
 * forces `pr`.) From the launch composer, where these lines lived:
 * Delivery (crew#293/studio#123, wire reworked by crew#393): a repo-scoped
 * BUILD launch ALWAYS carries the key — `'pr'` when the toggle is on,
 * `'none'` when it is off. Explicit-off matters on the 0.18.0 wire: the
 * daemon now DEFAULTS an omitted `deliver` to `'pr'` for exactly these
 * launches, so an OFF toggle that merely omitted the key would deliver
 * anyway. Both guards stay: `deliver` without `workflow` is a 400 and the
 * deliver script pushes to the attached repo — either one missing and the
 * run launches WITHOUT the key (the daemon defaults those to `'none'`;
 * older daemons also 400 on `'none'`, so unlicensed bodies never carry it).
 * The same verdict is on screen before the operator sends (`deliverNotice`).
 * F-E2E-030: the deliver gate is the engine's default; the body says nothing to be gated.
 * Only the explicitly unattended postures send the opt-out — and only with a delivery.
 * §5.1: Unfiled = NO projectId key at all (the backend default); a selected
 * or pre-bound project files the run atomically with the launch.
 */
export function launchPostureFields(s: PostureFormState): LaunchPostureFields {
  const out: LaunchPostureFields = {};
  if (s.plan !== null) out.plan = s.plan;
  else if (s.workflow) out.workflow = s.workflow;
  if (s.repoRef !== null) out.repoRef = s.repoRef;
  if (s.projectId) out.projectId = s.projectId;
  if (s.launchKind === 'build' && s.repoRef !== null) out.deliver = s.deliverOn ? 'pr' : 'none';
  if (out.deliver === 'pr' && s.autoDeliver && s.daemonDeliverGate === true) out.deliverGate = 'auto';
  if (s.revising) out.deliver = 'pr';
  return out;
}

/**
 * The preview's identity: the fields plus the person's power choice. `humanConfirm` is not part of
 * it — crew's power decision does not read it, and the `before:N` shift past the PA's scope step is
 * only resolved at Send.
 */
export function postureKey(fields: LaunchPostureFields, powerChoice: boolean | undefined): string {
  return JSON.stringify([
    fields.workflow ?? null,
    fields.plan ?? null,
    fields.repoRef ?? null,
    fields.projectId ?? null,
    fields.deliver ?? null,
    fields.deliverGate ?? null,
    powerChoice ?? null,
  ]);
}

/**
 * What the launch sends as `power`: `true` only when crew's answer for exactly this key said power;
 * `false` otherwise (no answer for it, or phased). `undefined` on a daemon without power mode, whose
 * launch schema may not take the key.
 */
export function powerToSend(powerCap: boolean, answer: LaunchPreviewPosture | null): boolean | undefined {
  if (!powerCap) return undefined;
  return answer?.power === true;
}

/** The "gate:" words of a power run, from crew's answer: it asks at hand-off only when it delivers with a person. */
export function powerGateWords(p: LaunchPreviewPosture): string {
  return p.deliver === 'pr' && !p.autoDeliver
    ? 'at hand-off, plus any pause policy requires (power mode)'
    : 'no step gates, only a pause policy requires (power mode)';
}

/** The gate-deciding fields of a launch body as built (what Send carries), for its {@link postureKey}. */
export function postureFieldsOfBody(body: {
  workflow?: string;
  plan?: LaunchPlan;
  repoRef?: string;
  projectId?: string;
  deliver?: 'pr' | 'none';
  deliverGate?: string;
}): LaunchPostureFields {
  return {
    ...(body.plan !== undefined ? { plan: body.plan } : body.workflow !== undefined ? { workflow: body.workflow } : {}),
    ...(body.repoRef !== undefined ? { repoRef: body.repoRef } : {}),
    ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
    ...(body.deliver !== undefined ? { deliver: body.deliver } : {}),
    ...(body.deliverGate === 'auto' ? { deliverGate: 'auto' as const } : {}),
  };
}
