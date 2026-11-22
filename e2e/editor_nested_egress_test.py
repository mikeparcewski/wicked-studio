#!/usr/bin/env python3
"""
editor_nested_egress_test.py — no WebRTC out of the HTML a first-party editor shows in its nested frame, held by a
real browser, on the editors built from THIS checkout (studio#946).

The page, document and deck editors show agent-authored HTML in a nested `sandbox="allow-scripts"` `srcdoc` frame,
passed through `guardNestedHtml` (src/plugins/_shared/nestedGuard.ts): the WebRTC prelude first in every inline script,
and a hash-only meta policy first in `<head>`. Studio's unit tests check that markup in jsdom; this journey checks
that Chromium enforces it. Crew's own probe (crew `tests/editor-webrtc-egress.test.ts`) runs the editors of the studio
RELEASE crew bundles; this one runs the editors a studio PR is about to ship.

  1. The built `dist-sameorigin/editors/wicked-{page,doc,deck}/index.html` carry the guard.
  2. CONTROL: the same hostile document, framed under the same bundle policy WITHOUT studio's guard, gets packets
     to the loopback sink. That proves the sink and the browser's WebRTC work here, so zero below means something.
  3. Each editor, served the way crew serves a first-party bundle (crew `src/editors/csp.ts`: the policy and headers
     below), behind a minimal editor host (`plugin.ready` -> `host.hello` -> `artifact.read` answered with the
     document), is shown a hostile document per attempt: WebRTC directly, from a new realm (srcdoc copy or fresh,
     `javascript:`/`blob:`/`data:` child, navigation, worker, inline handler), from a module that shadows `window`,
     through the parent frame, and an external script admitted by its own hash. Each attempt gets its own loopback
     UDP sink standing in for a STUN server. Every attempt must send ZERO packets and no HTTP request, while the
     editor still starts, reads the document and runs its script (`agent-ran`), so it cannot pass by not running.

The bundle frame's own WebRTC prelude is crew's (`webrtc-guard.ts`, added when crew serves a bundle) and is covered
by crew's probe; it is not applied here. The `parent` attempt shows the nested frame cannot reach the bundle's
constructors anyway (its sandbox gives it an origin of its own).

No fixture daemon: a small server of its own. Env: FEEDBACK_PORT (default 4718). Prints a JSON report; exit 0/1.
"""

import json
import os
import socket
import sys
import threading
import time
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from uxfix_fixture import REPO, ensure_build

PORT = int(os.environ.get("FEEDBACK_PORT", "4718"))
EDITORS = ("wicked-page", "wicked-doc", "wicked-deck")
REFUSED = "WebRTC is not available in an editor frame"

report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


# ── crew's first-party bundle serving (crew packages/crew/src/editors/csp.ts, `bundleHeaders` with firstParty) ──────
BUNDLE_CSP = ("sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; "
              "img-src data: blob:{MEDIA}; media-src blob:; font-src data:{MEDIA}; frame-src 'none'; "
              "child-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; "
              "worker-src 'none'; manifest-src 'none'")
BUNDLE_HEADERS = {"Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff",
                  "X-DNS-Prefetch-Control": "off", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}


def bundle_csp(manifest: dict) -> str:
    media = " https:" if any(p.get("id") == "network.media" for p in manifest.get("permissions", [])) else ""
    return BUNDLE_CSP.replace("{MEDIA}", media)


def shell_csp(origin: str) -> str:
    """crew's `shellCsp`: what any frame of studio's shell may point at."""
    return f"frame-src {origin}/api/v1/editors/ {origin}/api/v1/projects/ blob: data:"


# ── the hostile document (crew's `agentDoc` / `NESTED_ATTEMPTS`, plus `parent`) ──────────────────────────────────────
SHADOWING_MODULE = (
    "<script type=\"module\">function window(){} function self(){} function globalThis(){} function TypeError(){ top.postMessage({probe:'shadow-called'},'*') }"
    "top.postMessage({probe:'module-ran'},'*');var C=document.defaultView.RTCPeerConnection;var pc=new C({iceServers:[{urls:'stun:127.0.0.1:__PORT__'}]});"
    "pc.createDataChannel('x');pc.createOffer().then(function(o){return pc.setLocalDescription(o)})</script>")
MODULE_ALONE_IN_CHILD = ("var m=document.querySelector('script[type=module]');var f=document.createElement('iframe');"
                         "f.srcdoc='<scr'+'ipt type=module>'+m.textContent+'</scr'+'ipt>';document.body.appendChild(f)")
ATTEMPTS: dict[str, str] = {
    "direct": "rtc(window,'agent')",
    # The bundle frame holds the constructors (crew's prelude is not applied here): the nested frame cannot reach them.
    "parent": "rtc(parent,'parent')",
    "srcdoc-copy": "var f=document.createElement('iframe');f.srcdoc=CHILD;document.body.appendChild(f)",
    "srcdoc-fresh": "var f=document.createElement('iframe');f.srcdoc=FRESH;document.body.appendChild(f)",
    "handler": "document.body.insertAdjacentHTML('beforeend','<img src=x onerror=\"'+(report+rtc+'rtc(window,\\'handler\\')').replace(/&/g,'&amp;').replace(/\"/g,'&quot;')+'\">')",
    "javascript-child": "var f=document.createElement('iframe');f.src='javascript:'+JSON.stringify(CHILD);document.body.appendChild(f)",
    "blob-child": "var f=document.createElement('iframe');f.src=URL.createObjectURL(new Blob([CHILD],{type:'text/html'}));document.body.appendChild(f)",
    "data-child": "var f=document.createElement('iframe');f.src='data:text/html,'+encodeURIComponent(CHILD);document.body.appendChild(f)",
    "navigate-blob": "location.href=URL.createObjectURL(new Blob([CHILD],{type:'text/html'}))",
    "navigate-data": "location.href='data:text/html,'+encodeURIComponent(CHILD)",
    "worker": "try{var w=new Worker(URL.createObjectURL(new Blob(['postMessage(typeof RTCPeerConnection)'],{type:'text/javascript'})));w.onmessage=function(e){report('worker:'+e.data)}}catch(e){report('worker-threw')}",
    "module-shadow": MODULE_ALONE_IN_CHILD,
    "external-integrity": "crypto.subtle.digest('SHA-256',new TextEncoder().encode(SELF)).then(function(d){var s=document.createElement('script');s.integrity='sha256-'+btoa(String.fromCharCode.apply(null,new Uint8Array(d)));s.src=SINK;document.body.appendChild(s);report('nested-external-added')})",
}


def agent_doc(editor: str, attempt: str, port: int, sink_url: str) -> str:
    """A document written to get WebRTC out: its own script reports `agent-ran` and makes one attempt; any new realm
    it makes runs a copy of that script and reports `child-*`."""
    js = (f"var U={json.dumps(str(port))};\n"
          "function report(m){try{top.postMessage({probe:String(m)},'*')}catch(e){}}\n"
          "function rtc(W,tag){try{var C=W.RTCPeerConnection||W.webkitRTCPeerConnection;if(typeof C!=='function'){report(tag+':no-ctor');return}\n"
          "var pc=new C({iceServers:[{urls:'stun:127.0.0.1:'+U}]});pc.createDataChannel('x');pc.createOffer().then(function(o){return pc.setLocalDescription(o)});report(tag+':rtc-created')}catch(e){report(tag+':rtc-threw:'+e.name)}}\n"
          "var SELF=document.currentScript?document.currentScript.textContent:'';\n"
          "var CHILD='<scr'+'ipt>'+SELF+'</scr'+'ipt>';\n"
          "var FRESH='<scr'+'ipt>var U='+JSON.stringify(U)+';'+report+rtc+'rtc(window,\"fresh\")</scr'+'ipt>';\n"
          f"var SINK={json.dumps(sink_url)};\n"
          "if(!document.documentElement.hasAttribute('data-agent-root')){report('child-ran:'+location.protocol);rtc(window,'child')}\n"
          f"else if(!window.__probeDone){{window.__probeDone=1;report('agent-ran');{ATTEMPTS[attempt]}}}")
    scripts = (SHADOWING_MODULE.replace("__PORT__", str(port)) if attempt == "module-shadow" else "") + f"<script>{js}</script>"
    if editor == "wicked-deck":
        return ("<!doctype html><html data-agent-root><head><style>.wi-slide{width:1280px;height:720px}</style></head>"
                "<body data-wi-kind=\"deck\"><section class=\"wi-slide\" data-wid=\"s0\" data-slide-id=\"s-a\">"
                f"<h1 data-wid=\"h0\">A slide</h1>{scripts}</section><section class=\"wi-slide\" data-wid=\"s1\" "
                "data-slide-id=\"s-b\"><h2 data-wid=\"h1\">Two</h2></section></body></html>")
    return f"<!doctype html><html data-agent-root><head><title>p</title></head><body><p data-wid=\"p0\">A page</p>{scripts}</body></html>"


class Sink:
    """A loopback UDP socket standing in for a STUN server: it counts every datagram that reaches it."""

    def __init__(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.settimeout(0.2)
        self.port = self.sock.getsockname()[1]
        self.count = 0
        self.open = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while self.open:
            try:
                self.sock.recvfrom(65536)
                self.count += 1
            except (socket.timeout, OSError):
                continue

    def close(self) -> None:
        self.open = False
        self.thread.join(timeout=1)
        self.sock.close()


dist = ensure_build(fail)
bundles: dict[str, dict] = {}
for eid in EDITORS:
    d = dist / "editors" / eid
    if not (d / "index.html").is_file():
        fail("built", f"{d}/index.html is missing from the build")
    bundles[eid] = {"body": (d / "index.html").read_bytes(), "manifest": json.loads((d / "editor.json").read_text())}
check("built", all(REFUSED.encode() in b["body"] for b in bundles.values()),
      guarded={e: REFUSED.encode() in b["body"] for e, b in bundles.items()})

docs: dict[str, str] = {}
sink_hits: dict[str, int] = {}
lock = threading.Lock()


def host_page(eid: str, doc: str) -> str:
    """Studio's host for a first-party editor, at its smallest: the one-time handshake, then `artifact.read` answered
    with the document (crew's probe host, the same wire)."""
    html = json.dumps(docs.get(doc, "")).replace("<", "\\u003c")
    entry = f"/api/v1/editors/{eid}/1.0.0/entry"
    return ("<!doctype html><body><script>window.R=[];var HTML=" + html + ";"
            "var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');f.style.cssText='width:1300px;height:800px';"
            f"f.src={json.dumps(entry)};var ch=new MessageChannel();"
            "addEventListener('message',function(e){var d=e.data||{};if(d.probe){R.push(d.probe);return}"
            "if(d.type==='plugin.ready'&&e.source===f.contentWindow){R.push('plugin-ready');f.contentWindow.postMessage({p:'wicked.editor',v:1,type:'host.hello',payload:{grants:['artifact.read'],size:'pane',theme:{}}},'*',[ch.port2])}});"
            "ch.port1.onmessage=function(m){var d=m.data||{};if(d.type==='artifact.read'&&d.id){R.push('artifact-read');ch.port1.postMessage({p:'wicked.editor',v:1,re:d.id,ok:true,payload:{version:1,head:1,content:{type:'html',html:HTML}}})}};"
            "document.body.appendChild(f);</script></body>")


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *args) -> None:  # quiet
        pass

    def _send(self, code: int, ctype: str, body: bytes, headers: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        parts = u.path.split("/")
        origin = f"http://127.0.0.1:{PORT}"
        if u.path == "/host":
            body = host_page(q.get("id", [""])[0], q.get("doc", [""])[0]).encode()
            return self._send(200, "text/html; charset=utf-8", body, {"Content-Security-Policy": shell_csp(origin)})
        if u.path == "/control":
            # The control: the document framed directly under the same bundle policy, no studio guard.
            src = json.dumps("/api/v1/editors/control/" + urllib.parse.quote(q.get("doc", [""])[0]) + "/entry")
            body = ("<!doctype html><body><script>window.R=[];addEventListener('message',function(e){if(e.data&&e.data.probe)R.push(e.data.probe)});"
                    "var f=document.createElement('iframe');f.setAttribute('sandbox','allow-scripts');"
                    f"f.src={src};document.body.appendChild(f);</script></body>").encode()
            return self._send(200, "text/html; charset=utf-8", body, {"Content-Security-Policy": shell_csp(origin)})
        if len(parts) == 7 and parts[1:4] == ["api", "v1", "editors"] and parts[4] == "control" and parts[6] == "entry":
            doc = docs.get(urllib.parse.unquote(parts[5]))
            if doc is None:
                return self._send(404, "application/json", b"{}")
            return self._send(200, "text/html; charset=utf-8", doc.encode(),
                              {"Content-Security-Policy": bundle_csp({}), **BUNDLE_HEADERS})
        if len(parts) == 7 and parts[1:4] == ["api", "v1", "editors"] and parts[6] == "entry" and parts[4] in bundles:
            b = bundles[parts[4]]
            return self._send(200, "text/html; charset=utf-8", b["body"],
                              {"Content-Security-Policy": bundle_csp(b["manifest"]), **BUNDLE_HEADERS})
        if len(parts) == 3 and parts[1] == "sink":
            with lock:
                sink_hits[parts[2]] = sink_hits.get(parts[2], 0) + 1
            return self._send(200, "text/javascript", b"/* sink */")
        self._send(404, "application/json", b"{}")


httpd = ThreadingHTTPServer(("127.0.0.1", PORT), partial(Handler, directory=str(dist)))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
ORIGIN = f"http://127.0.0.1:{PORT}"

from playwright.sync_api import sync_playwright  # noqa: E402


def attempt_in(browser, path: str, wait_for: list[str]) -> dict:
    """Open `path`, wait for each `wait_for` probe (10 s each), then watch for 1.2 s, as crew's probe does."""
    page = browser.new_page(viewport={"width": 1400, "height": 900})
    logs: list[str] = []
    page.on("console", lambda m: logs.append(m.text[:160]))
    page.on("pageerror", lambda e: logs.append(f"pageerror: {str(e)[:150]}"))
    try:
        page.goto(f"{ORIGIN}{path}")
        for probe in wait_for:
            try:
                page.wait_for_function(f"() => (window.R || []).includes({json.dumps(probe)})", timeout=10000)
            except Exception:  # noqa: BLE001 — the checks report what was said
                pass
        page.wait_for_timeout(1200)
        return {"said": page.evaluate("() => window.R || []"), "logs": logs}
    finally:
        page.close()


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── 2. control: the same document with no guard gets packets out ─────────────────────────────────────────────
    sink = Sink()
    try:
        docs["control-direct"] = agent_doc("wicked-page", "direct", sink.port, f"{ORIGIN}/sink/control")
        r = attempt_in(browser, "/control?doc=control-direct", ["agent-ran"])
        time.sleep(0.2)
        packets = sink.count
    finally:
        sink.close()
    check("control-unguarded-leaks", "agent:rtc-created" in r["said"] and packets > 0, packets=packets, said=r["said"])

    # ── 3. each built editor, each attempt: zero packets, zero requests, and the document really ran ──────────────
    for eid in EDITORS:
        outcomes: dict[str, int] = {}
        for attempt in ATTEMPTS:
            sink = Sink()
            doc = f"{eid}-{attempt}"
            try:
                docs[doc] = agent_doc(eid, attempt, sink.port, f"{ORIGIN}/sink/nested-{eid}")
                waits = ["agent-ran"] + (["nested-external-added"] if attempt == "external-integrity" else [])
                r = attempt_in(browser, f"/host?id={eid}&doc={urllib.parse.quote(doc)}", waits)
                time.sleep(0.2)
                packets = sink.count
            finally:
                sink.close()
            said = r["said"]
            with lock:
                hits = sink_hits.get(f"nested-{eid}", 0)
            ran = all(m in said for m in ("plugin-ready", "artifact-read", "agent-ran"))
            leaked = [m for m in said if "rtc-created" in m or m.startswith("module-ran") or m.startswith("shadow-called")]
            extra = True
            if attempt == "srcdoc-copy":
                extra = "child:no-ctor" in said  # the copy ran in the child, behind the prelude
            elif attempt == "module-shadow":
                extra = any(REFUSED in line for line in r["logs"])  # the guard stopped the module
            elif attempt == "external-integrity":
                extra = "nested-external-added" in said  # the external script was really added
            elif attempt == "parent":
                extra = any(m.startswith("parent:rtc-threw") or m == "parent:no-ctor" for m in said)
            outcomes[attempt] = packets
            check(f"{eid}:{attempt}", ran and packets == 0 and not leaked and hits == 0 and extra,
                  packets=packets, http_requests=hits, said=said, leaked=leaked,
                  logs=[line for line in r["logs"] if "WebRTC" in line or "pageerror" in line][:4])
        report["steps"][f"{eid}:summary"] = {"ok": True, "packets": outcomes}

    browser.close()

report["ok"] = all(s.get("ok") for s in report["steps"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
