import { sha256Base64 } from './sha256.js';

/**
 * No WebRTC from the HTML a first-party editor shows in a nested frame.
 *
 * The page editor (Document, Page) and the deck's slide frame show agent-authored HTML in a nested
 * `sandbox="allow-scripts"` `srcdoc` frame, with the `data-wid` bridge appended. That document inherits the bundle's
 * policy (`connect-src 'none'`, `frame-src 'none'`, and `script-src 'unsafe-inline'`, because a first-party bundle
 * must run whatever the document holds). No browser applies `connect-src` to WebRTC, so a script in the document
 * could still open an `RTCPeerConnection` to an address of its choosing. It could also do so from a fresh realm it
 * makes: a `srcdoc` child or a `javascript:` URL.
 *
 * {@link guardNestedHtml} is the last step before `srcdoc`:
 *  - {@link NESTED_PRELUDE} goes first in every inline script that runs. It defines each `RTC*` / `webkitRTC*` global
 *    as a locked `undefined` before the script's own first statement. It has no `try`: if it cannot do that it throws,
 *    and the script stops.
 *  - A `<meta http-equiv="Content-Security-Policy">` goes first in `<head>`, followed by the prelude on its own. Its
 *    `script-src` is exactly the hashes of those scripts, so no script runs without the prelude, in this document or
 *    any document it makes (they inherit the policy, and removing the `<meta>` does not lift it). `javascript:` URLs,
 *    inline event handlers and new script text are refused, and `frame-src 'none'` keeps child frames off URLs.
 *
 * Every hash this issues is of text it built to start with the prelude, so a script it misreads only fails to run.
 * The prelude is the same text crew puts in every editor bundle (crew `src/editors/webrtc-guard.ts`).
 */
export const NESTED_PRELUDE =
  '(function(w,o){var n=["RTCPeerConnection","webkitRTCPeerConnection","mozRTCPeerConnection","RTCDataChannel",' +
  '"RTCIceTransport","RTCDtlsTransport","RTCSctpTransport","RTCRtpSender","RTCRtpReceiver","RTCRtpTransceiver",' +
  '"RTCIceCandidate","RTCSessionDescription","RTCCertificate"],k=o.getOwnPropertyNames(w),i;' +
  'for(i=0;i!==k.length;i++)if(/^(webkit|moz)?RTC/.test(k[i]))n.push(k[i]);' +
  'for(i=0;i!==n.length;i++){o.defineProperty(w,n[i],{value:void 0,writable:false,enumerable:false,configurable:false});' +
  'if(w[n[i]]!==void 0)throw new TypeError("WebRTC is not available in an editor frame")}})(window,Object);\n';

/** The essences HTML runs as a classic script (HTML "JavaScript MIME type essence match"). */
const JS_TYPES = new Set([
  'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2',
  'text/javascript1.3', 'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript',
  'text/x-ecmascript', 'text/x-javascript',
]);

/** Whether the browser runs this script's text as a classic or module script (not external, not a data block). */
function runsInline(s: Element): boolean {
  if (s.hasAttribute('src')) return false;
  const language = s.getAttribute('language');
  const raw = s.hasAttribute('type') ? s.getAttribute('type')! : language !== null && language !== '' ? `text/${language}` : '';
  if (raw === '') return true;
  const type = raw.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase();
  return type === 'module' || JS_TYPES.has(type);
}

/** The document's own doctype, written back as it was (none stays none: the document keeps its rendering mode). */
function doctypeOf(doc: Document): string {
  return doc.doctype === null ? '' : new XMLSerializer().serializeToString(doc.doctype);
}

/** `html` as a nested editor frame may show it: the prelude in every script, and a policy that runs only those. */
export function guardNestedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const hashes = new Set<string>([sha256Base64(NESTED_PRELUDE)]);
  for (const script of Array.from(doc.querySelectorAll('script'))) {
    if (!runsInline(script)) continue;
    const text = NESTED_PRELUDE + (script.textContent ?? '');
    script.textContent = text;
    hashes.add(sha256Base64(text));
  }
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute(
    'content',
    `script-src ${[...hashes].map((h) => `'sha256-${h}'`).join(' ')}; frame-src 'none'; child-src 'none'; worker-src 'none'`,
  );
  const prelude = doc.createElement('script');
  prelude.textContent = NESTED_PRELUDE;
  doc.head.prepend(policy, prelude);
  return `${doctypeOf(doc)}${doc.documentElement.outerHTML}`;
}
