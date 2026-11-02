import { sha256Base64 } from './sha256.js';

/**
 * No WebRTC from the HTML a first-party editor shows in a nested frame.
 *
 * The page editor (the Document and Page editors) and the deck's slide frame show agent-authored HTML in a nested
 * `sandbox="allow-scripts"` `srcdoc` frame, with the `data-wid` bridge appended. That document inherits the bundle's
 * policy (`connect-src 'none'`, `frame-src 'none'`, and `script-src 'unsafe-inline'`, because a first-party bundle
 * must run whatever the document holds). No browser applies `connect-src` to WebRTC, so a script in the document
 * could still open an `RTCPeerConnection` to an address of its choosing. It could also do so from a fresh realm it
 * makes: a `srcdoc` child or a `javascript:` URL.
 *
 * {@link guardNestedHtml} is the last step before `srcdoc`:
 *  - {@link NESTED_PRELUDE} goes first in every inline script that runs (after a hashbang line and a directive
 *    prologue, which run nothing and keep strict mode; a directive ended by automatic semicolon insertion is kept too,
 *    with a `;` written before the prelude). It defines each WebRTC global as a locked `undefined` before
 *    the script's own first statement. It has no `try`: if it cannot do that it throws, and the script stops. It checks
 *    that `window` is the window (a module's own `function window(){}` is bound before its first statement), takes
 *    `Object` from a literal, and throws a string, never calling anything a script could have declared.
 *  - A `<meta http-equiv="Content-Security-Policy">` goes first in `<head>`, followed by the prelude on its own. Its
 *    `script-src` is exactly the hashes of those scripts, with `frame-src`, `child-src`, `worker-src` and `object-src`
 *    `'none'`. No script runs without the prelude, in this document or any document it makes (they inherit the
 *    policy, and removing the `<meta>` does not lift it). `javascript:` URLs, inline event handlers and new script text
 *    are refused.
 *
 * Every hash this issues is of text it built with the prelude first, so a script it misreads only fails to run.
 * The prelude is the same text crew puts in every editor bundle (crew `src/editors/webrtc-guard.ts`); both repos'
 * tests pin its sha256.
 */
const REFUSAL = 'WebRTC is not available in an editor frame';
const GLOBALS = [
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection', 'RTCDataChannel', 'RTCIceTransport',
  'RTCDtlsTransport', 'RTCSctpTransport', 'RTCRtpSender', 'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCIceCandidate',
  'RTCSessionDescription', 'RTCCertificate',
];
export const NESTED_PRELUDE =
  '(function(w,o){if(typeof w!=="object"||w===null||w.window!==w)throw ' + JSON.stringify(REFUSAL) + ';var n=' +
  JSON.stringify(GLOBALS) +
  ',k=o.getOwnPropertyNames(w),i,d;for(i=0;i!==k.length;i++)if(/^(webkit|moz)?RTC/.test(k[i])&&(d=o.getOwnPropertyDescriptor(w,k[i]))&&d.configurable)n.push(k[i]);' +
  'for(i=0;i!==n.length;i++){o.defineProperty(w,n[i],{value:void 0,writable:false,configurable:false});' +
  'if(w[n[i]]!==void 0)throw ' + JSON.stringify(REFUSAL) + '}})(window,({}).constructor);\n';

const LINE_END = /[\n\r\u2028\u2029]/;
const SPACE = /\s/;
const IDENTIFIER_PART = /[\w$\\\u0080-\uFFFF]/; // `\` too: an identifier may be written with escapes

/**
 * Whether a directive with no `;` ends before `text[i]` by automatic semicolon insertion: a line ended after it, and
 * what follows cannot continue the expression (end of text, a statement-starting word other than `in`/`instanceof`, a
 * number, a string, a block, a unary `!` or `~`, or `++`/`--`, which may not follow a line end). Any binary operator,
 * bracket, dot or template continues it, so it does not count.
 */
function endsByAsi(text: string, i: number): boolean {
  if (i >= text.length) return true;
  const c = text[i]!;
  if (c === '"' || c === "'" || c === '{' || c === '~' || /[0-9]/.test(c)) return true;
  if (c === '!') return text[i + 1] !== '=';
  // `.5` is a number, and `\u0074op` an identifier written with an escape (an escaped `in` is no keyword).
  if (c === '.') return /[0-9]/.test(text[i + 1] ?? '');
  if (c === '\\') return true;
  if (c === '+' || c === '-') return text[i + 1] === c;
  if (!IDENTIFIER_PART.test(c)) return false;
  let j = i;
  while (j < text.length && IDENTIFIER_PART.test(text[j]!)) j++;
  const word = text.slice(i, j);
  return word !== 'in' && word !== 'instanceof';
}

/**
 * Where the prelude goes in a script's text, read the way a JavaScript lexer reads it: past a hashbang line and a
 * directive prologue (string-literal statements, each ended by its own `;` or by automatic semicolon insertion), with
 * whitespace and comments between. No regular expression does this: a backtracking pattern can be made to end a
 * comment early or late. Here a block comment ends at its first `*\/` and a line comment at the end of its line, exactly
 * as in JavaScript, so nothing before the place found is code. `semicolon` says the last directive ended by insertion,
 * so the prelude must be written after a `;` of its own.
 */
export function prologueEnd(text: string): { at: number; afterHashbang: boolean; semicolon: boolean } {
  const n = text.length;
  let i = 0;
  let at = 0;
  let afterHashbang = false;
  let semicolon = false;
  if (text.startsWith('#!')) {
    while (i < n && !LINE_END.test(text[i]!)) i++;
    at = i;
    afterHashbang = true;
  }
  let crossed = false;
  // At the start of a line (only whitespace and comments since the last line end): where a classic script's `-->`
  // opens a line comment.
  let lineStart = true;
  // HTML-like comments (`<!--`, a line-leading `-->`) are comments only in a classic script. In a module, after an
  // operand, `<!--x` is `< !--x`: code. So they are taken only before the first directive, where in a module they can
  // only be a syntax error (nothing runs) and in a classic script they are comments.
  let beforeDirectives = true;
  /** Past whitespace and whole comments (noting a line end); false at a block comment that never closes. */
  const skip = (): boolean => {
    for (;;) {
      while (i < n && SPACE.test(text[i]!)) {
        if (LINE_END.test(text[i]!)) {
          crossed = true;
          lineStart = true;
        }
        i++;
      }
      if (beforeDirectives && lineStart && text.startsWith('-->', i)) {
        while (i < n && !LINE_END.test(text[i]!)) i++;
        continue;
      }
      if (text.startsWith('/*', i)) {
        const close = text.indexOf('*/', i + 2);
        if (close < 0) return false;
        if (LINE_END.test(text.slice(i, close))) {
          crossed = true;
          lineStart = true;
        }
        i = close + 2;
      } else if (text.startsWith('//', i) || (beforeDirectives && text.startsWith('<!--', i))) {
        // `<!--` opens a comment to the end of its line in a classic script (it is a syntax error in a module).
        while (i < n && !LINE_END.test(text[i]!)) i++;
      } else {
        return true;
      }
    }
  };
  while (skip()) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") break;
    beforeDirectives = false;
    let j = i + 1;
    let closed = false;
    while (j < n) {
      const c = text[j]!;
      if (c === '\\') { j += 2; continue; }
      if (c === quote) { closed = true; j += 1; break; }
      if (c === '\n' || c === '\r') break;
      j += 1;
    }
    if (!closed) break;
    lineStart = false;
    const end = j;
    i = j;
    crossed = false;
    if (!skip()) break;
    if (text[i] === ';') {
      i += 1;
      lineStart = false;
      at = i;
      semicolon = false;
    } else if (crossed && endsByAsi(text, i)) {
      at = end;
      semicolon = true;
    } else {
      break;
    }
    afterHashbang = false;
  }
  return { at, afterHashbang, semicolon };
}

/** `text` with the prelude before its first statement (see {@link prologueEnd}): after a `;` of its own when the last
 *  directive ended by insertion, and on its own line after a lone hashbang. */
export function withNestedPrelude(text: string): string {
  const { at, afterHashbang, semicolon } = prologueEnd(text);
  return text.slice(0, at) + (semicolon ? ';' : '') + (afterHashbang ? '\n' : '') + NESTED_PRELUDE + text.slice(at);
}

/** The essences HTML runs as a classic script (HTML "JavaScript MIME type essence match"). */
const JS_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';

/** Whether the browser runs this script's text as a classic or module script (not external, not a data block). An SVG
 *  script is external by `href` or `xlink:href`; `src` means nothing there. */
function runsInline(s: Element): boolean {
  if (s.namespaceURI === SVG_NS ? s.hasAttribute('href') || s.hasAttribute('xlink:href') : s.hasAttribute('src')) return false;
  const language = s.namespaceURI === SVG_NS ? null : s.getAttribute('language'); // HTML's legacy fallback, not SVG's
  const raw = s.hasAttribute('type') ? s.getAttribute('type')! : language !== null && language !== '' ? `text/${language}` : '';
  if (raw === '') return true;
  // A JavaScript MIME type is matched with surrounding whitespace stripped; `module` exactly as written (Chromium).
  if (raw.toLowerCase() === 'module') return true;
  return JS_TYPES.has(raw.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase());
}

/** Every script in the document, including those inside `<template>` contents (a declarative shadow root, or a template
 *  the document clones at run time), which `querySelectorAll` does not enter. */
function scriptsIn(root: ParentNode): Element[] {
  const out: Element[] = Array.from(root.querySelectorAll('script'));
  // Only an HTML template has contents: a `<template>` inside <svg> or <math> is a foreign element (its scripts are
  // ordinary children, already found above).
  for (const t of Array.from(root.querySelectorAll('template'))) if (t.namespaceURI === HTML_NS) out.push(...scriptsIn(t.content));
  return out;
}

/** The document's own doctype, written back as it was (none stays none: the document keeps its rendering mode). */
function doctypeOf(doc: Document): string {
  // A document the parser put in quirks mode keeps it: written back without a doctype (a re-serialized legacy doctype
  // can read as a standards one).
  if (doc.doctype === null || doc.compatMode === 'BackCompat') return '';
  return new XMLSerializer().serializeToString(doc.doctype);
}

/** `html` as a nested editor frame may show it: the prelude in every script, and a policy that runs only those. */
export function guardNestedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hashes = new Set<string>([sha256Base64(NESTED_PRELUDE)]);
  for (const script of scriptsIn(doc)) {
    if (!runsInline(script)) continue;
    // As the browser will read it back from the serialized document: a CR (an SVG script's `&#13;`) becomes LF.
    const text = withNestedPrelude((script.textContent ?? '').replace(/\r\n?/g, '\n'));
    script.textContent = text;
    hashes.add(sha256Base64(text));
  }
  // The document's own enforcing policy would still hash the scripts as they were, and refuse them as rewritten. This
  // frame stays under the bundle's policy and the one written below, so the document's own is dropped.
  for (const own of Array.from(doc.querySelectorAll('meta[http-equiv]'))) {
    if (own.getAttribute('http-equiv')!.trim().toLowerCase() === 'content-security-policy') own.remove();
  }
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute(
    'content',
    `script-src ${[...hashes].map((h) => `'sha256-${h}'`).join(' ')}; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'`,
  );
  // A second policy: inline scripts only, no URL. A hash would also admit an external script whose `integrity` names it,
  // fetched before it is checked; the bundle's own policy refuses that too, this keeps the document safe without it.
  const inlineOnly = doc.createElement('meta');
  inlineOnly.setAttribute('http-equiv', 'Content-Security-Policy');
  inlineOnly.setAttribute('content', "script-src 'unsafe-inline'");
  const prelude = doc.createElement('script');
  prelude.textContent = NESTED_PRELUDE;
  doc.head.prepend(policy, inlineOnly, prelude);
  return `${doctypeOf(doc)}${doc.documentElement.outerHTML}`;
}
