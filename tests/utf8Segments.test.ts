// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { splitUtf8 } from '../src/board/utf8Segments.js';

/** A terminal's binary frames, split into valid UTF-8 text and the bytes that are not (codex r2 on #484). */
const show = (r: ReturnType<typeof splitUtf8>) => ({
  parts: r.parts.map((p) => (typeof p === 'string' ? p : [...p])),
  pending: [...r.pending],
});
const bytes = (...xs: number[]) => new Uint8Array(xs);
const enc = (s: string) => new TextEncoder().encode(s);

describe('splitUtf8', () => {
  it('a valid frame is one text part', () => {
    expect(show(splitUtf8(enc('héllo ✓')))).toStrictEqual({ parts: ['héllo ✓'], pending: [] });
  });
  it('an invalid byte is its own raw part, between the text around it', () => {
    expect(show(splitUtf8(new Uint8Array([...enc('ab'), 0xff, ...enc('cd')])))).toStrictEqual({ parts: ['ab', [0xff], 'cd'], pending: [] });
  });
  it('an incomplete sequence at the end is held for the next frame', () => {
    expect(show(splitUtf8(bytes(0x61, 0xe2, 0x82)))).toStrictEqual({ parts: ['a'], pending: [0xe2, 0x82] });
  });
  it('a held lead byte followed by a byte that cannot continue it: both reach the output, none dropped', () => {
    expect(show(splitUtf8(bytes(0xe2, 0x82, 0xff)))).toStrictEqual({ parts: [[0xe2, 0x82], [0xff]], pending: [] });
  });
  it('overlongs and surrogates are not text', () => {
    expect(show(splitUtf8(bytes(0xc0, 0xaf)))).toStrictEqual({ parts: [[0xc0], [0xaf]], pending: [] });
    expect(show(splitUtf8(bytes(0xed, 0xa0, 0x80)))).toStrictEqual({ parts: [[0xed], [0xa0], [0x80]], pending: [] });
  });
});
