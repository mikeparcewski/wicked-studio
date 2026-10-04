import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { focusBeside } from '../src/editors/focus.js';

/**
 * EP-P2 (DES-EDITOR-PLUGINS-001 §5.10 rule 5): Tab / Shift+Tab forwarded from a plugin's edge move the
 * focus to the host control beside the frame, in the direction pressed — never onto the body (codex r1).
 */
beforeAll(() => {
  // jsdom lays nothing out: every element counts as on screen here.
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return document.body; } });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('focusBeside', () => {
  it('Tab lands on the host control after the frame, Shift+Tab on the one before — never the body', () => {
    document.body.innerHTML = '<button id="rail">Rail</button><div><button id="before">Back</button><iframe id="f" title="plugin"></iframe><button id="after">Undo</button></div><a id="later" href="#x">later</a>';
    const frame = document.getElementById('f')!;
    expect(focusBeside(frame, false)?.id).toBe('after');
    expect(document.activeElement?.id).toBe('after');
    expect(focusBeside(frame, true)?.id).toBe('before');
    expect(document.activeElement?.id).toBe('before');
  });
  it('wraps at the ends; disabled, hidden and inert controls are not in the ring', () => {
    document.body.innerHTML = '<button id="first">a</button><button id="dis" disabled>b</button><iframe id="f" title="plugin"></iframe><button id="hid" hidden>c</button><div inert><button id="in">d</button></div><span tabindex="-1" id="skip">e</span>';
    const frame = document.getElementById('f')!;
    expect(focusBeside(frame, false)?.id).toBe('first');
    expect(focusBeside(frame, true)?.id).toBe('first');
  });
  it('codex r2: a control inside a disabled fieldset is not in the ring — Tab reaches the enabled control after it', () => {
    document.body.innerHTML = '<button id="before">a</button><iframe id="f" title="plugin"></iframe><fieldset disabled><button id="unavailable">Unavailable</button></fieldset><button id="after">Undo</button>';
    const frame = document.getElementById('f')!;
    expect(focusBeside(frame, false)?.id).toBe('after');
    expect(document.activeElement?.id).toBe('after');
  });
  it('codex r3: a disabled fieldset disables only its form controls — the button in its first legend and a link inside it stay in the ring', () => {
    // HTML: `fieldset[disabled]` disables descendant form controls EXCEPT those in its first <legend>;
    // an <a href> is never a form control, so it is never disabled by one.
    document.body.innerHTML = '<button id="before">a</button><iframe id="f" title="plugin"></iframe><fieldset disabled><legend><button id="enable">Enable section</button></legend><a href="#help" id="help">Help</a><button id="blocked">Blocked</button></fieldset><button id="after">Undo</button>';
    const frame = document.getElementById('f')!;
    expect(focusBeside(frame, false)?.id).toBe('enable');
    expect(focusBeside(document.getElementById('enable'), false)?.id).toBe('help');
    expect(focusBeside(document.getElementById('help'), false)?.id).toBe('after');
  });
  it('with no frame to stand beside: Tab goes to the first control, Shift+Tab to the last', () => {
    document.body.innerHTML = '<button id="a">a</button><button id="z">z</button>';
    expect(focusBeside(null, false)?.id).toBe('a');
    expect(focusBeside(null, true)?.id).toBe('z');
    document.body.innerHTML = '';
    expect(focusBeside(null, false)).toBeNull();
  });
});
