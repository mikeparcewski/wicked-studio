import { describe, expect, it } from 'vitest';

import {
  launchPostureFields,
  postureFieldsOfBody,
  postureKey,
  powerGateWords,
  powerToSend,
  type PostureFormState, isLaunchPreviewPosture } from '../src/board/launchPosture.js';

/** studio#1150: the form's gate-deciding fields are built once, keyed without humanConfirm, and `power` is sent only as crew answered. */
const base: PostureFormState = {
  launchKind: 'build',
  plan: null,
  workflow: 'feature',
  repoRef: 'wicked-studio',
  projectId: null,
  deliverOn: true,
  autoDeliver: false,
  daemonDeliverGate: true,
  revising: false,
};

describe('launchPostureFields', () => {
  it('carries what a repo-scoped build launch sends', () => {
    expect(launchPostureFields(base)).toEqual({ workflow: 'feature', repoRef: 'wicked-studio', deliver: 'pr' });
    expect(launchPostureFields({ ...base, deliverOn: false })).toMatchObject({ deliver: 'none' });
    expect(launchPostureFields({ ...base, autoDeliver: true })).toMatchObject({ deliver: 'pr', deliverGate: 'auto' });
    // An older daemon without the deliver gate: no opt-out key.
    expect(launchPostureFields({ ...base, autoDeliver: true, daemonDeliverGate: null })).not.toHaveProperty('deliverGate');
    expect(launchPostureFields({ ...base, projectId: 'p1' })).toMatchObject({ projectId: 'p1' });
  });

  it('a revision always delivers, and its deliver gate is decided on the toggle (main\'s order)', () => {
    const f = launchPostureFields({ ...base, deliverOn: false, autoDeliver: true, revising: true });
    expect(f.deliver).toBe('pr');
    expect(f).not.toHaveProperty('deliverGate');
  });

  it('no repo, or not a build: no delivery key', () => {
    expect(launchPostureFields({ ...base, repoRef: null })).toEqual({ workflow: 'feature' });
    expect(launchPostureFields({ ...base, launchKind: 'chat' })).toEqual({ workflow: 'feature', repoRef: 'wicked-studio' });
  });

  it('the body built from the fields keys the same as the fields (what Send reads is what was previewed)', () => {
    for (const s of [base, { ...base, autoDeliver: true }, { ...base, revising: true, deliverOn: false }, { ...base, repoRef: null }, { ...base, plan: { steps: [{ catalog: 'build' }] } }]) {
      const fields = launchPostureFields(s);
      const body = { problem: 'x', humanConfirm: 'before:2', entityMode: 'shared', ...fields };
      for (const choice of [undefined, false] as const) {
        expect(postureKey(postureFieldsOfBody(body), choice)).toBe(postureKey(fields, choice));
      }
    }
  });
});

describe('postureKey', () => {
  it('changes with every field crew decides on and the power choice, not with humanConfirm', () => {
    const k = postureKey(launchPostureFields(base), undefined);
    expect(postureKey(launchPostureFields({ ...base, workflow: 'bug' }), undefined)).not.toBe(k);
    expect(postureKey(launchPostureFields({ ...base, repoRef: 'other' }), undefined)).not.toBe(k);
    expect(postureKey(launchPostureFields({ ...base, deliverOn: false }), undefined)).not.toBe(k);
    expect(postureKey(launchPostureFields({ ...base, projectId: 'p' }), undefined)).not.toBe(k);
    expect(postureKey(launchPostureFields(base), false)).not.toBe(k);
  });
});

describe('powerToSend', () => {
  it('true only on crew\'s power answer; false with no answer or an unknown daemon; absent only on a daemon without power', () => {
    const power = { power: true, deliver: 'pr' as const, autoDeliver: false };
    expect(powerToSend(true, power)).toBe(true);
    expect(powerToSend(true, { ...power, power: false })).toBe(false);
    expect(powerToSend(true, null)).toBe(false);
    expect(powerToSend(null, null)).toBe(false);
    expect(powerToSend(false, power)).toBeUndefined();
  });
});

describe('powerGateWords', () => {
  it('names the hand-off only when the run delivers with a person', () => {
    expect(powerGateWords({ power: true, deliver: 'pr', autoDeliver: false })).toMatch(/^at hand-off/);
    expect(powerGateWords({ power: true, deliver: 'pr', autoDeliver: true })).toMatch(/^no step gates/);
    expect(powerGateWords({ power: true, deliver: 'none', autoDeliver: false })).toMatch(/^no step gates/);
  });
});

describe('isLaunchPreviewPosture (studio#1192): only a complete posture is an answer', () => {
  it('admits the api-types shape, with or without its optional words', () => {
    expect(isLaunchPreviewPosture({ power: true, humanConfirm: 'none', deliver: 'pr', autoDeliver: false })).toBe(true);
    expect(isLaunchPreviewPosture({ power: false, deliver: 'none', autoDeliver: false, powerNotice: 'why' })).toBe(true);
  });
  it('refuses anything incomplete or mistyped', () => {
    for (const bad of [
      null, undefined, [], 'power', { power: true }, { power: true, deliver: 'pr' }, { power: 'yes', deliver: 'pr', autoDeliver: false },
      { power: true, deliver: 'push', autoDeliver: false }, { power: true, deliver: 'pr', autoDeliver: 'no' },
      { power: true, deliver: 'pr', autoDeliver: false, humanConfirm: 3 }, { power: true, deliver: 'pr', autoDeliver: false, powerNotice: null },
    ]) expect(isLaunchPreviewPosture(bad), JSON.stringify(bad) ?? 'undefined').toBe(false);
  });
});
