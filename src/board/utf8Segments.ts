/**
 * A terminal's binary output frame, split into valid UTF-8 text and the bytes that are not
 * (studio#467, codex r2 on #484). The text runs can go through the home-directory masker; the
 * other bytes are drawn exactly as they came. A sequence cut by the end of the frame is returned as
 * `pending`, to be put in front of the next frame — nothing is decoded lossily and no byte is lost.
 *
 * Validity follows the UTF-8 rules (RFC 3629): no overlong forms, no surrogates, nothing past
 * U+10FFFF. An invalid sequence is reported as its maximal valid prefix (one raw part), then the
 * scan restarts at the byte that broke it.
 */

/** The allowed range of the byte after `lead`, and how many bytes the sequence has (0 = invalid lead). */
function shape(lead: number): { len: number; lo: number; hi: number } {
  if (lead < 0x80) return { len: 1, lo: 0x80, hi: 0xbf };
  if (lead >= 0xc2 && lead <= 0xdf) return { len: 2, lo: 0x80, hi: 0xbf };
  if (lead === 0xe0) return { len: 3, lo: 0xa0, hi: 0xbf };
  if (lead === 0xed) return { len: 3, lo: 0x80, hi: 0x9f };
  if (lead >= 0xe1 && lead <= 0xef) return { len: 3, lo: 0x80, hi: 0xbf };
  if (lead === 0xf0) return { len: 4, lo: 0x90, hi: 0xbf };
  if (lead === 0xf4) return { len: 4, lo: 0x80, hi: 0x8f };
  if (lead >= 0xf1 && lead <= 0xf3) return { len: 4, lo: 0x80, hi: 0xbf };
  return { len: 0, lo: 0, hi: 0 };
}

const decoder = new TextDecoder('utf-8');

export function splitUtf8(buf: Uint8Array): { parts: (string | Uint8Array)[]; pending: Uint8Array } {
  const parts: (string | Uint8Array)[] = [];
  let textStart = 0;
  let i = 0;
  const flushText = (end: number): void => {
    if (end > textStart) parts.push(decoder.decode(buf.subarray(textStart, end)));
  };
  while (i < buf.length) {
    const { len, lo, hi } = shape(buf[i]!);
    if (len === 1) { i += 1; continue; }
    let j = 1;
    let ok = len > 0;
    while (ok && j < len && i + j < buf.length) {
      const b = buf[i + j]!;
      ok = j === 1 ? b >= lo && b <= hi : b >= 0x80 && b <= 0xbf;
      if (ok) j += 1;
    }
    if (ok && j === len) { i += len; continue; }
    flushText(i);
    if (ok && i + j === buf.length) {
      // Cut by the end of the frame: the rest of it comes with the next one.
      return { parts, pending: buf.slice(i) };
    }
    // The maximal valid prefix: the lead byte and the continuation bytes that fit it (`j` >= 1).
    parts.push(buf.slice(i, i + j));
    i += j;
    textStart = i;
  }
  flushText(buf.length);
  return { parts, pending: new Uint8Array(0) };
}
