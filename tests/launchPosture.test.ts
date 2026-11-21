import { describe, expect, it } from 'vitest';

import {
  launchPosture,
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

describe('launchPosture: shown words and launch payload (studio#1179)', () => {
  const cases = (['before', 'all', 'none'] as const).flatMap((confirmMode) =>
    (['balanced', 'autonomous', 'ask'] as const).flatMap((mode) =>
      (['on', 'off', 'unsupported', 'failed'] as const).flatMap((power) =>
        ([true, null] as const).flatMap((daemonDeliverGate) =>
          [true, false].flatMap((deliverOn) =>
            [true, false].map((revising) => ({ confirmMode, mode, power, daemonDeliverGate, deliverOn, revising })))))));

  it.each(cases)('$confirmMode / $mode / power=$power / health=$daemonDeliverGate / deliver=$deliverOn / revising=$revising', (s) => {
    const unattended = s.mode === 'autonomous' || (s.mode !== 'ask' && s.confirmMode === 'none');
    // Preserve main's ordering: the toggle decides the gate before a revision forces delivery.
    const auto = s.deliverOn && unattended && s.daemonDeliverGate === true;
    const deliver = s.deliverOn || s.revising ? 'pr' : 'none';
    const ready = s.power === 'on' || s.power === 'off';
    const { shown, payload } = launchPosture({
      ...base, ...s,
      beforeOrd: 1,
      deliverNoticeOn: s.deliverOn,
      powerCap: true,
      powerChoice: s.power === 'off' ? false : undefined,
      takesPower: true,
      previewAnswer: ready
        ? { status: 'ready', posture: { power: s.power === 'on', deliver, autoDeliver: auto } }
        : { status: s.power === 'failed' ? 'failed' : 'none' },
    });

    expect(payload.fields).toEqual({ workflow: 'feature', repoRef: 'wicked-studio', deliver, ...(auto ? { deliverGate: 'auto' } : {}) });
    expect(payload.power).toBe(s.power === 'on');
    expect(shown.selector === 'power').toBe(payload.power === true);
    expect(shown.gateWords.includes('(power mode)')).toBe(payload.power === true);
    const phasedWords = s.mode === 'ask' || s.confirmMode === 'all' && s.mode !== 'autonomous'
      ? 'every unit' : s.mode === 'autonomous' ? 'no human gates' : s.confirmMode === 'before' ? 'first gate' : 'no gates';
    expect(shown.gateWords).toBe(s.power === 'on'
      ? deliver === 'pr' && !auto
        ? 'at hand-off, plus any pause policy requires (power mode)'
        : 'no step gates, only a pause policy requires (power mode)'
      : phasedWords);
    // Without crew's answer main uses the notice, even when a revision forces a PR on the wire.
    expect(shown.delivers).toBe(ready ? payload.fields.deliver === 'pr' : s.deliverOn);
    expect(shown.deliverGateWord).toBe((ready ? auto : unattended && s.daemonDeliverGate === true) ? 'auto' : 'human');
    if (ready || s.deliverOn) expect(shown.deliverGateWord === 'auto').toBe(payload.fields.deliverGate === 'auto');
    expect(shown.powerSwitch).toBe(ready);
    expect(shown.unchecked).toBe(s.power === 'failed' ? 'failed' : s.power === 'unsupported' ? 'unsupported' : null);
  });

  it('keeps crew authoritative when its preparation drops delivery or changes its gate', () => {
    const input = {
      ...base, mode: 'autonomous' as const, confirmMode: 'before' as const, beforeOrd: 2,
      deliverNoticeOn: true, powerCap: true, powerChoice: undefined, takesPower: true,
    };
    const { shown, payload } = launchPosture({
      ...input, previewAnswer: { status: 'ready', posture: { power: true, deliver: 'none', autoDeliver: false } },
    });
    expect(payload.fields).toMatchObject({ deliver: 'pr', deliverGate: 'auto' });
    expect(shown).toMatchObject({ selector: 'power', delivers: false, deliverGateWord: 'human' });
  });

  it.each([
    { takesPower: true, status: 'loading', powerChoice: undefined, unchecked: null, powerSwitch: false, power: false },
    { takesPower: true, status: 'failed', powerChoice: false, unchecked: 'failed', powerSwitch: true, power: false },
    { takesPower: true, status: 'none', powerChoice: false, unchecked: null, powerSwitch: true, power: false },
    { takesPower: null, status: 'none', powerChoice: undefined, unchecked: null, powerSwitch: false, power: false },
    { takesPower: false, status: 'none', powerChoice: undefined, unchecked: null, powerSwitch: false, power: undefined },
  ] as const)('pending/unknown/older daemon: $takesPower / $status / choice=$powerChoice', (s) => {
    const { shown, payload } = launchPosture({
      ...base, mode: undefined, confirmMode: 'before', beforeOrd: 3, deliverNoticeOn: true,
      daemonDeliverGate: false, powerCap: s.takesPower === true, powerChoice: s.powerChoice,
      takesPower: s.takesPower, previewAnswer: { status: s.status },
    });
    expect(shown).toEqual({ selector: 'select', gateWords: 'before unit #3', delivers: true,
      deliverGateWord: 'unsupported', powerSwitch: s.powerSwitch, unchecked: s.unchecked });
    expect(payload.power).toBe(s.power);
    expect(payload.fields).not.toHaveProperty('deliverGate');
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
  it('sends false when health is unknown even if crew answers power', () => {
    expect(powerToSend(null, { power: true, deliver: 'pr', autoDeliver: false })).toBe(false);
  });

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
