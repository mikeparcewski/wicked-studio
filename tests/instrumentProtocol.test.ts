// The instrument protocol's runtime validation — DES-MERGE-001 §5.5, slices 11+12.
//
// The bridge lives inside `sandbox="allow-scripts"`. Its payloads are authored by
// AGENT-WRITTEN HTML that was itself influenced by untrusted input (attached source
// files, scraped pages). "Never trust frame payloads" is therefore not a style rule —
// it is the reason the sandbox is closeable at all, and these are its teeth.
import { describe, expect, it } from 'vitest';
import {
  REQUEST_INVENTORY, makeScrollToWid, parseInbound,
} from '../src/interactive/instrument-protocol.js';

const RECT = { x: 10, y: 20, width: 100, height: 40, top: 20, left: 10, right: 110, bottom: 60 };

describe('parseInbound — well-formed v1 frames', () => {
  it('accepts a wid-inventory and returns it NARROWED, not the raw object', () => {
    const parsed = parseInbound({
      v: 1, type: 'wid-inventory', widMap: { h1: RECT }, scrollX: 0, scrollY: 120,
      // Extra keys are the bridge's business; they must not survive into our state.
      cookies: 'nope', __proto__: { polluted: true },
    });
    expect(parsed).toEqual({
      v: 1, type: 'wid-inventory', widMap: { h1: RECT }, scrollX: 0, scrollY: 120,
    });
    expect(parsed).not.toHaveProperty('cookies');
  });

  it('accepts scroll-state and scroll-ack', () => {
    expect(parseInbound({ v: 1, type: 'scroll-state', scrollX: 5, scrollY: 6 }))
      .toEqual({ v: 1, type: 'scroll-state', scrollX: 5, scrollY: 6 });
    expect(parseInbound({ v: 1, type: 'scroll-ack', wid: 'h1' }))
      .toEqual({ v: 1, type: 'scroll-ack', wid: 'h1' });
  });

  it('an empty inventory is VALID — a document with no anchors is a real document', () => {
    expect(parseInbound({ v: 1, type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 }))
      .toEqual({ v: 1, type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 });
  });
});

describe('parseInbound — malformed inbound messages are DROPPED', () => {
  const junk: [string, unknown][] = [
    ['null',                    null],
    ['a bare string',           'wid-inventory'],
    ['a number',                42],
    ['no version',              { type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 }],
    ['a future version',        { v: 2, type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 }],
    ['a string version',        { v: '1', type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: 0 }],
    ['an unknown type',         { v: 1, type: 'eval-this', code: 'alert(1)' }],
    ['no type at all',          { v: 1, widMap: {}, scrollX: 0, scrollY: 0 }],
    ['widMap missing',          { v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0 }],
    ['widMap not an object',    { v: 1, type: 'wid-inventory', widMap: 'h1', scrollX: 0, scrollY: 0 }],
    ['widMap is null',          { v: 1, type: 'wid-inventory', widMap: null, scrollX: 0, scrollY: 0 }],
    ['scroll missing',          { v: 1, type: 'wid-inventory', widMap: {} }],
    ['scroll not finite',       { v: 1, type: 'wid-inventory', widMap: {}, scrollX: 0, scrollY: NaN }],
    ['scroll is Infinity',      { v: 1, type: 'wid-inventory', widMap: {}, scrollX: Infinity, scrollY: 0 }],
    ['scroll is a string',      { v: 1, type: 'scroll-state', scrollX: '0', scrollY: '0' }],
    ['ack with no wid',         { v: 1, type: 'scroll-ack' }],
    ['ack with an empty wid',   { v: 1, type: 'scroll-ack', wid: '' }],
    ['ack with a non-string',   { v: 1, type: 'scroll-ack', wid: { toString: () => 'h1' } }],
  ];
  it.each(junk)('drops %s', (_label, data) => {
    expect(parseInbound(data)).toBeNull();
  });

  // The strict rule §5.5 asks for: partial trust is worse than no trust. One bad rect
  // in a hundred means the frame is not speaking the protocol, and a half-applied
  // inventory would anchor comments to the WRONG elements — silently.
  it('ONE malformed rect invalidates the WHOLE inventory, not just that entry', () => {
    const parsed = parseInbound({
      v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0,
      widMap: { h1: RECT, p1: { ...RECT, width: 'wide' } },
    });
    expect(parsed).toBeNull();
  });

  it.each([
    ['a missing field',   { x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1 }],
    ['a NaN field',       { ...RECT, top: NaN }],
    ['a null rect',       null],
    ['a string rect',     '0,0,1,1'],
    ['an array rect',     [0, 0, 1, 1]],
  ])('rejects an inventory whose rect has %s', (_label, bad) => {
    expect(parseInbound({
      v: 1, type: 'wid-inventory', widMap: { h1: bad }, scrollX: 0, scrollY: 0,
    })).toBeNull();
  });
});

describe('outbound messages', () => {
  it('the inventory request is a frozen v1 singleton', () => {
    expect(REQUEST_INVENTORY).toEqual({ v: 1, type: 'request-inventory' });
    expect(Object.isFrozen(REQUEST_INVENTORY)).toBe(true);
  });

  it('scroll-to-wid carries the version so a stale bridge can drop it', () => {
    expect(makeScrollToWid('slide-2-heading-1'))
      .toEqual({ v: 1, type: 'scroll-to-wid', wid: 'slide-2-heading-1' });
  });
});
