#!/usr/bin/env python3
"""
editor_conformance_test.py — the editor plugin conformance suite (DES-EDITOR-PLUGINS-001 §12.1,
slice EP-P1), driving studio's conformance host page (/editors/conformance) against fixture bundles
served by a stand-in for crew's EP-C1 bundle route (hash-pinned, with the bundle CSP; the shell is
served with crew's frame-src policy).

  python3 e2e/editor_conformance_test.py                # all three: good, hostile, wicked-page (CI)
  python3 e2e/editor_conformance_test.py --bundle both  # the two fixture bundles only
  python3 e2e/editor_conformance_test.py --bundle good  # cases 1-12 against a good plugin (pass)
  python3 e2e/editor_conformance_test.py --bundle hostile  # cases 13-18: each attack caught by the host
  python3 e2e/editor_conformance_test.py --bundle wicked-page  # cases 1-12 against the real built-in page plugin (EP-P2)

Honest gaps, reported in the output rather than passed: case 10 checks keyboard reachability and
visible focus but runs no axe (not installed here); case 3 intercepts requests and cannot see
WebRTC/STUN or DNS prefetch (§12.1 says so); case 9 waits one ping period, not a whole session.

Captures: e2e/shots/editor-conformance-*.png. Env: FEEDBACK_PORT (default 4351).
"""

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.parse
import urllib.request

from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4351"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
FIX = REPO / "e2e" / "editor-fixtures"

ap = argparse.ArgumentParser()
ap.add_argument("--bundle", choices=["good", "hostile", "both", "wicked-page", "all"], default="all")
args = ap.parse_args()

report: dict = {"ok": False, "cases": {}, "gaps": [
    "case 10: keyboard reachability + visible focus only; axe is not run (not installed in this harness)",
    "case 3: request interception cannot see WebRTC/STUN or DNS prefetch (DES §12.1, [A11])",
    "case 9: liveness is checked over one ping period (10 s), not a whole scripted session; no Long Tasks probe",
]}


def fail(case: str, why) -> None:
    report["cases"][case] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(case: str, ok: bool, **detail) -> None:
    report["cases"][case] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def sha(name: str) -> str:
    return hashlib.sha256((FIX / f"{name}.html").read_bytes()).hexdigest()


def studio_editor(editor_id: str) -> dict:
    """A first-party editor the served dist carries (EP-P2): its manifest and the entry's pinned hash."""
    d = dist / "editors" / editor_id
    manifest = json.loads((d / "editor.json").read_text())
    return {"version": manifest["version"], "sha": hashlib.sha256((d / "index.html").read_bytes()).hexdigest(), "title": manifest["title"]}


GOOD_GRANTS = "artifact.read,artifact.write,selection.chip,composer.draft,checks.contribute,ui.fullscreen"

dist = ensure_build(fail)
origin = start_server(PORT, dist)
set_fixture(origin, editors=True, shell_csp=True, reset_gate_posts=True)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)


def url(editor: str, bundle: str, grants: str = GOOD_GRANTS, sha_override: str | None = None) -> str:
    if bundle == "wicked-page":
        e = studio_editor("wicked-page")
        q = {"editor": "wicked-page", "version": e["version"], "sha": sha_override or e["sha"], "title": e["title"], "grants": grants}
    else:
        q = {"editor": editor, "version": "0.1.0", "sha": sha_override or sha(bundle), "title": f"{bundle.title()} fixture",
             "grants": grants}
    return f"{origin}/editors/conformance?{urllib.parse.urlencode(q)}"


LOG = "() => (window.__wickedEditor?.log ?? []).map(e => ({kind: e.kind, type: e.type ?? null, code: e.code ?? null, why: e.why ?? e.reason ?? null}))"
COMPOSER = "() => window.__wickedEditor?.composer() ?? null"


def log(page) -> list:
    return page.evaluate(LOG)


def count(page, kind: str, type_: str | None = None) -> int:
    return sum(1 for e in log(page) if e["kind"] == kind and (type_ is None or e["type"] == type_))


def open_editor(page, editor: str, bundle: str, **kw) -> None:
    page.goto(url(editor, bundle, **kw), wait_until="networkidle")
    page.get_by_test_id("editor-host-page").wait_for(state="visible", timeout=15000)
    page.wait_for_function("() => (window.__wickedEditor?.log ?? []).some(e => e.kind === 'handshake')", timeout=5000)


def gate_posts() -> int:
    with urllib.request.urlopen(f"{origin}/__fixture/gate-posts", timeout=10) as r:
        return len(json.loads(r.read())["posts"])


with sync_playwright() as p:
    browser = p.chromium.launch()
    errors: list[str] = []

    # ── cases 1-12: a good plugin passes ──────────────────────────────────────────
    if args.bundle in ("good", "both", "all"):
        page = browser.new_page(viewport={"width": W, "height": H})
        page.on("pageerror", lambda e: errors.append(str(e)))
        frame_requests: list[str] = []
        page.on("request", lambda r: frame_requests.append(r.url)
                if r.frame is not None and r.frame != page.main_frame and "/entry?" not in r.url else None)
        t0 = time.time()
        try:
            open_editor(page, "acme-good", "good")
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / "editor-conformance-good-missing.png"))
            fail("1-handshake", f"no handshake: {e}")
        frame = page.frame_locator('[data-testid="editor-frame"]')
        frame.locator('[data-wid="hero-title"]').wait_for(state="visible", timeout=5000)
        page.screenshot(path=str(SHOTS / "editor-conformance-good.png"))
        check("1-handshake", time.time() - t0 < 6 and count(page, "handshake") == 1
              and count(page, "ignored-window-message") == 0, seconds=round(time.time() - t0, 2))

        reads_before = page.evaluate("() => window.__wickedEditor.adapter.reads")
        for s in ("inline", "full", "pane"):
            page.evaluate(f"() => window.__wickedEditor.setSize('{s}')")
            page.wait_for_timeout(150)
        sizes = frame.locator("body").get_attribute("data-size")
        loads = count(page, "load")
        reads_after = page.evaluate("() => window.__wickedEditor.adapter.reads")
        check("2-sizes", sizes == "pane" and loads == 1 and reads_after == reads_before, data_size=sizes, loads=loads,
              reads=[reads_before, reads_after])

        # 5. typing never acts (before any selection so the counts are clean)
        frame.locator("#mode").click()
        typed_before = count(page, "in", "ui.typed")
        page.keyboard.type("approve this delete it", delay=60)
        page.wait_for_timeout(300)
        comp = page.evaluate(COMPOSER)
        typed = count(page, "in", "ui.typed") - typed_before
        writes = count(page, "in", "version.write")
        drafts = count(page, "in", "composer.draft")
        sels = count(page, "in", "selection.set")
        frame.locator('[data-wid="cta"]').click()
        page.keyboard.press("Backspace")
        page.keyboard.press("Delete")
        page.wait_for_timeout(200)
        writes_after_bs = count(page, "in", "version.write")
        check("5-typing-never-acts", typed == 1 and comp["text"] == "approve this delete it" and writes == 0 and drafts == 0
              and sels == 0 and writes_after_bs == 0, typed=typed, composer=comp["text"], writes=writes, drafts=drafts,
              selections=sels, writes_after_backspace=writes_after_bs)

        # 6. forwarding (real key presses inside the frame)
        frame.locator('[data-wid="cta"]').focus()
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        page.keyboard.press("Alt+j")
        frame.locator("#full").focus()
        page.keyboard.press("Tab")
        page.wait_for_timeout(200)
        keys = page.evaluate(COMPOSER)["keys"]
        check("6-forwarding", keys == ["Escape", "Mod+K", "Alt+J", "Tab"], keys=keys)

        # 7. edits: one write on Enter; a stale base is shown, not retried
        frame.locator('[data-wid="hero-title"]').dblclick()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("Book a room in a minute")
        page.keyboard.press("Enter")
        page.wait_for_function("() => window.__wickedEditor.log.some(e => e.kind === 'written')", timeout=5000)
        written = count(page, "written")
        thread = page.evaluate(COMPOSER)["thread"]
        frame.locator('[data-wid="price-body"]').dblclick()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("Answers the same day")
        page.evaluate("() => window.__wickedEditor.adapter.agentEdit()")  # an agent version lands, unseen
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        status = page.evaluate(COMPOSER)["status"]
        refused = [e for e in log(page) if e["kind"] == "refused" and e["type"] == "version.write"]
        check("7-edits", written == 1 and thread == ["Good fixture changed the hero title · Version 2"]
              and status == "Not changed: it moved while you typed" and len(refused) == 1 and refused[0]["code"] == "head_moved",
              written=written, thread=thread, status=status, refused=refused)

        # 8. strict input: fuzzed host messages don't break it; it still points
        for junk in ["null", "'x'", "{p:'wicked.editor'}", "{p:'wicked.editor',v:1,type:'nonsense',payload:{}}",
                     "{p:'wicked.editor',v:1,type:'host.size',payload:null}", "{p:'wicked.editor',v:1,type:'host.theme'}"]:
            page.evaluate(f"() => window.__wickedEditor.inject({junk})")
        page.wait_for_timeout(200)
        before = count(page, "in", "selection.set")
        frame.locator('[data-wid="price-title"]').click()
        page.wait_for_timeout(300)
        check("8-strict-input", count(page, "in", "selection.set") == before + 1 and count(page, "teardown") == 0)

        # 11. theme
        page.evaluate("() => window.__wickedEditor.setTheme({'--accent': '#aa0000'})")
        page.wait_for_timeout(300)
        anims = frame.locator("body").evaluate("() => document.getAnimations().length")
        check("11-theme", page.evaluate(COMPOSER)["status"] == "theme #aa0000" and anims == 0,
              status=page.evaluate(COMPOSER)["status"], animations=anims)

        # 10. accessibility (partial — see gaps): every part and control reachable, focus visible
        a11y = frame.locator("body").evaluate("""() => [...document.querySelectorAll('[data-wid], button')].map(el => {
            el.focus(); const s = getComputedStyle(el);
            return {tab: el.tabIndex, focused: document.activeElement === el, ring: s.boxShadow !== 'none' || s.outlineStyle !== 'none'}; })""")
        check("10-accessibility-keyboard", all(x["tab"] >= 0 and x["focused"] for x in a11y), controls=len(a11y))

        # 9. liveness: one ping period passes; it answered
        page.wait_for_timeout(11_500)
        check("9-liveness", count(page, "teardown") == 0 and page.evaluate("() => window.__wickedEditor.host()?.alive === true"))

        # 3. no network from the plugin
        check("3-no-network", frame_requests == [], requests=frame_requests)

        # 4. permissions: grants withdrawn mid-session → not_granted, and it keeps working
        page.evaluate("() => window.__wickedEditor.host().setGrants(['artifact.read','selection.chip'])")
        frame.locator('[data-wid="price-title"]').dblclick()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("Fixed fee")
        page.keyboard.press("Enter")
        page.wait_for_timeout(400)
        not_granted = [e for e in log(page) if e["kind"] == "refused" and e["code"] == "not_granted"]
        before = count(page, "in", "selection.set")
        frame.locator('[data-wid="cta"]').click()
        page.wait_for_timeout(300)
        check("4-permissions", len(not_granted) == 1 and count(page, "in", "selection.set") == before + 1
              and page.evaluate("() => window.__wickedEditor.host()?.alive === true"), not_granted=not_granted)

        # 12. the pinned hash: the right one loads (above); a wrong one never starts
        page.goto(url("acme-good", "good", sha_override="0" * 64), wait_until="networkidle")
        try:
            page.get_by_test_id("editor-torn").wait_for(state="visible", timeout=6000)
            torn = page.get_by_test_id("editor-torn").inner_text()
        except Exception:  # noqa: BLE001
            torn = None
        check("12-hash-pinned", torn is not None and "didn’t start" in torn and count(page, "handshake") == 0, torn=torn)
        page.close()

    # ── cases 1-12 against the REAL built-in page plugin (EP-P2) ────────────────────
    # The plugin renders the page in a nested sandboxed frame: elements are clicked there, the
    # plugin's own controls (the editor root, the edit field) are in the plugin frame. Enter opens the
    # picked element's field; typing with nothing picked goes to the composer (rule 2).
    if args.bundle in ("wicked-page", "all"):
        PAGE_GRANTS = "artifact.read,artifact.write,selection.chip,network.media"
        page = browser.new_page(viewport={"width": W, "height": H})
        page.on("pageerror", lambda e: errors.append(str(e)))
        frame_requests: list[str] = []
        page.on("request", lambda r: frame_requests.append(r.url)
                if r.frame is not None and r.frame != page.main_frame and "/entry?" not in r.url else None)
        t0 = time.time()
        try:
            open_editor(page, "wicked-page", "wicked-page", grants=PAGE_GRANTS)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(SHOTS / "editor-conformance-page-missing.png"))
            fail("1-handshake", f"no handshake: {e}")
        plugin = page.frame_locator('[data-testid="editor-frame"]')
        doc = plugin.frame_locator('[data-testid="page-frame"]')
        root = plugin.locator('[data-testid="page-editor"]')
        doc.locator('[data-wid="hero-title"]').wait_for(state="visible", timeout=8000)
        page.screenshot(path=str(SHOTS / "editor-conformance-page.png"))
        check("1-handshake", time.time() - t0 < 8 and count(page, "handshake") == 1 and count(page, "ignored-window-message") == 0,
              seconds=round(time.time() - t0, 2))

        def pf():
            return next(f for f in page.frames if f.parent_frame == page.main_frame and "/api/v1/editors/" in f.url)

        def wait_pickable(head: int) -> None:
            deadline = time.time() + 10
            while time.time() < deadline:
                got = pf().evaluate("() => { const e = document.querySelector('[data-testid=\"page-editor\"]'); return e ? [e.dataset.pickable, e.dataset.head] : null; }")
                if got == ["true", str(head)]:
                    return
                page.wait_for_timeout(150)
            fail("pickable", f"the plugin never became pickable at head {head}: {got}")

        PLUGIN_STATE = """() => { const e = document.querySelector('[data-testid="page-editor"]'); const i = document.querySelector('[data-testid="page-edit-input"]');
            return { active: document.activeElement ? (document.activeElement.id || document.activeElement.tagName) : null, hasFocus: document.hasFocus(),
                     selected: e?.dataset.selected, pickable: e?.dataset.pickable, head: e?.dataset.head, size: e?.dataset.size, field: i ? !i.hidden : null,
                     hint: document.querySelector('[data-testid="page-hint"]')?.textContent ?? null }; }"""

        def plugin_state() -> dict:
            try:
                return pf().evaluate(PLUGIN_STATE)
            except Exception as e:  # noqa: BLE001
                return {"error": str(e)}

        def pick(wid: str) -> None:
            # The click lands in the nested page frame; the plugin picks on the bridge's message and takes the
            # focus back onto its handle — a key pressed before that would stay in the page. Wait for both.
            # EP-P3 (§7.1 R-c): a second click on the element already picked picks its SECTION, so an
            # element that is already the subject is not clicked again — the focus goes back to it.
            if plugin_state().get("selected") == wid:
                pf().evaluate("() => document.getElementById('handle').focus()")
            else:
                doc.locator(f'[data-wid="{wid}"]').click()
            try:
                plugin.locator(f'[data-testid="page-selected-box"][data-wid="{wid}"]').wait_for(state="visible", timeout=5000)
                pf().wait_for_function("() => document.activeElement?.id === 'handle'", timeout=5000)
            except Exception:  # noqa: BLE001
                fail("pick", {"why": f"{wid} was not picked", "plugin": plugin_state()})

        def edit(wid: str, text: str) -> None:
            pick(wid)
            page.keyboard.press("Enter")
            try:
                plugin.locator('[data-testid="page-edit-input"]').wait_for(state="visible", timeout=5000)
            except Exception:  # noqa: BLE001
                page.screenshot(path=str(SHOTS / "editor-conformance-page-edit-timeout.png"))
                fail("edit", {"why": f"Enter did not open the field on {wid}", "plugin": plugin_state(),
                              "host_active": page.evaluate("() => document.activeElement?.dataset?.testid ?? document.activeElement?.tagName ?? null")})
            page.keyboard.press("ControlOrMeta+a")
            page.keyboard.type(text)
            page.keyboard.press("Enter")

        # 2. sizes: the same document through inline / full / pane — no reload, no re-read
        wait_pickable(1)
        reads_before = page.evaluate("() => window.__wickedEditor.adapter.reads")
        for s in ("inline", "full", "pane"):
            page.evaluate(f"() => window.__wickedEditor.setSize('{s}')")
            page.wait_for_timeout(150)
        sizes = plugin.locator("body").get_attribute("data-size")
        loads = count(page, "load")
        reads_after = page.evaluate("() => window.__wickedEditor.adapter.reads")
        check("2-sizes", sizes == "pane" and loads == 1 and reads_after == reads_before, data_size=sizes, loads=loads, reads=[reads_before, reads_after])

        # 5. typing never acts: nothing picked → the first key goes to the composer, the rest follow it there
        root.focus()
        typed_before = count(page, "in", "ui.typed")
        page.keyboard.type("approve this delete it", delay=60)
        page.wait_for_timeout(300)
        comp = page.evaluate(COMPOSER)
        typed = count(page, "in", "ui.typed") - typed_before
        writes = count(page, "in", "version.write")
        drafts = count(page, "in", "composer.draft")
        sels = count(page, "in", "selection.set")
        pick("cta")
        page.keyboard.press("Backspace")
        page.keyboard.press("Delete")
        page.wait_for_timeout(200)
        writes_after_bs = count(page, "in", "version.write")
        check("5-typing-never-acts", typed == 1 and comp["text"] == "approve this delete it" and writes == 0 and drafts == 0
              and sels == 0 and writes_after_bs == 0, typed=typed, composer=comp["text"], writes=writes, drafts=drafts,
              selections=sels, writes_after_backspace=writes_after_bs)

        # 6. forwarding: Esc with nothing picked, ⌘K, a navigation chord, and Tab at the plugin's edges —
        # EP-P3 gave the page editor its own controls (the width header, the peek), so from the root
        # Shift+Tab leaves backwards (forwarded) and Tab ENTERS the first control (§5.10 rule 5).
        page.keyboard.press("Escape")  # lets go of cta (the plugin's own)
        page.wait_for_timeout(100)
        root.focus()
        page.keyboard.press("Escape")
        page.keyboard.press("Control+k")
        page.keyboard.press("Alt+j")
        page.keyboard.press("Shift+Tab")
        page.wait_for_timeout(200)
        keys = page.evaluate(COMPOSER)["keys"]
        root.focus()
        page.keyboard.press("Tab")
        page.wait_for_timeout(150)
        entered = pf().evaluate("() => document.activeElement?.dataset?.testid ?? null")
        keys_after = page.evaluate(COMPOSER)["keys"]
        check("6-forwarding", keys == ["Escape", "Mod+K", "Alt+J", "Shift+Tab"] and entered == "page-width" and keys_after == keys,
              keys=keys, tab_entered=entered, keys_after_tab=keys_after)

        # 7. edits: one write on Enter, the host's line; a stale base is shown, not retried
        edit("hero-title", "Book a room in a minute")
        page.wait_for_function("() => window.__wickedEditor.log.some(e => e.kind === 'written')", timeout=5000)
        written = count(page, "written")
        thread = page.evaluate(COMPOSER)["thread"]
        wait_pickable(2)
        pick("price-body")
        page.keyboard.press("Enter")
        plugin.locator('[data-testid="page-edit-input"]').wait_for(state="visible", timeout=5000)
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type("Answers the same day")
        page.evaluate("() => window.__wickedEditor.adapter.agentEdit()")  # an agent version lands, unseen
        page.keyboard.press("Enter")
        page.wait_for_timeout(600)
        status = page.evaluate(COMPOSER)["status"]
        refused = [e for e in log(page) if e["kind"] == "refused" and e["type"] == "version.write"]
        check("7-edits", written == 1 and thread == ["You changed the hero title · Version 2"]
              and status == "Not changed: it moved while you typed" and len(refused) == 1 and refused[0]["code"] == "head_moved",
              written=written, thread=thread, status=status, refused=refused)

        # 8. strict input: fuzzed host messages don't break it; it still points
        for junk in ["null", "'x'", "{p:'wicked.editor'}", "{p:'wicked.editor',v:1,type:'nonsense',payload:{}}",
                     "{p:'wicked.editor',v:1,type:'host.size',payload:null}", "{p:'wicked.editor',v:1,type:'host.theme'}"]:
            page.evaluate(f"() => window.__wickedEditor.inject({junk})")
        page.wait_for_timeout(200)
        wait_pickable(3)
        before = count(page, "in", "selection.set")
        pick("price-title")
        page.wait_for_timeout(300)
        check("8-strict-input", count(page, "in", "selection.set") == before + 1 and count(page, "teardown") == 0)

        # 11. theme: the host's tokens reach the plugin's chrome; nothing animates on it
        page.evaluate("() => window.__wickedEditor.setTheme({'--accent': '#aa0000'})")
        page.wait_for_timeout(300)
        accent = pf().evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()")
        anims = pf().evaluate("() => document.getAnimations().length")
        check("11-theme", accent == "#aa0000" and anims == 0, accent=accent, animations=anims)

        # 10. accessibility (partial — see gaps): the plugin's one control is reachable and shows its focus
        a11y = pf().evaluate("""() => { const el = document.querySelector('[data-testid="page-editor"]'); el.focus();
            const s = getComputedStyle(el); return {tab: el.tabIndex, focused: document.activeElement === el, ring: s.boxShadow !== 'none' || s.outlineStyle !== 'none'}; }""")
        check("10-accessibility-keyboard", a11y["tab"] >= 0 and a11y["focused"] and a11y["ring"], **a11y)

        # 9. liveness: one ping period passes; it answered
        page.wait_for_timeout(11_500)
        check("9-liveness", count(page, "teardown") == 0 and page.evaluate("() => window.__wickedEditor.host()?.alive === true"))

        # 3. no network from the plugin or the page inside it (this page has no web images)
        check("3-no-network", frame_requests == [], requests=frame_requests)

        # 4. permissions: write withdrawn mid-session → not_granted, said on the page; pointing still works
        page.evaluate("() => window.__wickedEditor.host().setGrants(['artifact.read','selection.chip'])")
        edit("price-title", "Fixed fee")
        page.wait_for_timeout(400)
        not_granted = [e for e in log(page) if e["kind"] == "refused" and e["code"] == "not_granted"]
        before = count(page, "in", "selection.set")
        pick("cta")
        page.wait_for_timeout(300)
        check("4-permissions", len(not_granted) == 1 and count(page, "in", "selection.set") == before + 1
              and page.evaluate("() => window.__wickedEditor.host()?.alive === true"), not_granted=not_granted)

        # 12. the pinned hash: a wrong one never starts
        page.goto(url("wicked-page", "wicked-page", grants=PAGE_GRANTS, sha_override="0" * 64), wait_until="networkidle")
        try:
            page.get_by_test_id("editor-torn").wait_for(state="visible", timeout=6000)
            torn = page.get_by_test_id("editor-torn").inner_text()
        except Exception:  # noqa: BLE001
            torn = None
        check("12-hash-pinned", torn is not None and "didn’t start" in torn and count(page, "handshake") == 0, torn=torn)
        page.close()

    # ── cases 13-18: the host catches each attack ─────────────────────────────────
    if args.bundle in ("hostile", "both", "all"):
        page = browser.new_page(viewport={"width": W, "height": H})
        page.on("pageerror", lambda e: errors.append(str(e)))
        off_origin: list[str] = []
        page.on("request", lambda r: off_origin.append(r.url) if "example.invalid" in r.url else None)
        HOSTILE = "artifact.read,artifact.write,selection.chip,composer.draft,ui.fullscreen"

        def run_case(name: str) -> None:
            page.evaluate(f"() => window.__wickedEditor.inject({{p:'wicked.editor',v:1,type:'conformance.run',payload:{{case:'{name}'}}}})")

        open_editor(page, "acme-hostile", "hostile", grants=HOSTILE)
        frame = page.frame_locator('[data-testid="editor-frame"]')
        frame.locator("#keybtn").wait_for(state="visible", timeout=5000)

        # 13. self-navigation: off-origin blocked by frame-src; same-origin → second load → teardown
        # Off-origin: frame-src blocks it before a request leaves; the browser's blocked-page load in
        # the frame is a second load, so the host tears the frame down too.
        run_case("navigate-off")
        page.wait_for_timeout(1500)
        torn_off = page.get_by_test_id("editor-torn").inner_text() if page.get_by_test_id("editor-torn").count() else None
        if torn_off is not None:
            page.get_by_test_id("editor-reload").click()
        page.wait_for_function("() => window.__wickedEditor.host()?.connected === true", timeout=5000)
        handshakes = count(page, "handshake")
        # Same-origin: the second document loads — teardown, no second hello, its plugin.ready ignored.
        run_case("navigate-same")
        page.get_by_test_id("editor-torn").wait_for(state="visible", timeout=6000)
        torn = page.get_by_test_id("editor-torn").inner_text()
        page.wait_for_timeout(800)
        check("13-self-navigation", off_origin == [] and "reloaded itself" in torn and count(page, "handshake") == handshakes,
              off_origin=off_origin, off_origin_teardown=torn_off, torn=torn, handshakes=count(page, "handshake"))
        base_handshakes = count(page, "handshake")

        # 14. forged keys: without a press all dropped (and the third drop tears down); with one, still dropped
        page.get_by_test_id("editor-reload").click()
        page.wait_for_function(f"() => window.__wickedEditor.log.filter(e => e.kind === 'handshake').length === {base_handshakes + 1}", timeout=5000)
        run_case("forged-keys")
        page.get_by_test_id("editor-torn").wait_for(state="visible", timeout=5000)
        torn14 = page.get_by_test_id("editor-torn").inner_text()
        keys14 = page.evaluate(COMPOSER)["keys"]
        page.get_by_test_id("editor-reload").click()
        page.wait_for_function(f"() => window.__wickedEditor.log.filter(e => e.kind === 'handshake').length === {base_handshakes + 2}", timeout=5000)
        frame = page.frame_locator('[data-testid="editor-frame"]')
        frame.locator("#keybtn").click()  # a real click: activation, and still not forwardable
        page.wait_for_timeout(300)
        keys14b = page.evaluate(COMPOSER)["keys"]
        check("14-forged-keys", keys14 == [] and keys14b == [] and "keys it may not" in torn14 and gate_posts() == 0,
              torn=torn14, keys=keys14b, gate_posts=gate_posts())

        # 15. forged typing (and a forwardable key) with NO activation, a 40-character string, and typing
        # after focus left the frame: all dropped, the composer unchanged. Playwright's evaluate carries a
        # user gesture, so the no-activation attack runs 6 s later (`-later`), once it has expired.
        def reload_hostile() -> None:
            if page.get_by_test_id("editor-torn").count():
                page.get_by_test_id("editor-reload").click()
            n = count(page, "handshake")
            page.wait_for_function(f"() => window.__wickedEditor.log.filter(e => e.kind === 'handshake').length >= {n}"
                                   " && window.__wickedEditor.host()?.connected === true", timeout=5000)

        page.get_by_test_id("editor-reload").click() if page.get_by_test_id("editor-torn").count() else None
        page.get_by_test_id("editor-artifact-frame").click(position={"x": 5, "y": 5})  # nothing pending
        reload_hostile()
        mark = len(log(page))
        run_case("forged-escape-later")
        run_case("forged-typing-later")
        page.wait_for_timeout(6800)
        later = [e for e in log(page)[mark:] if e["kind"] == "dropped"]
        keys15 = page.evaluate(COMPOSER)["keys"]
        reload_hostile()
        # Activation in the HOST, focus outside the frame (the operator clicked the composer).
        page.get_by_test_id("editor-composer").click()
        mark = len(log(page))
        run_case("forged-typing")
        page.wait_for_timeout(400)
        focus_drops = [e for e in log(page)[mark:] if e["kind"] == "dropped" and e["type"] == "ui.typed"]
        comp15 = page.evaluate(COMPOSER)
        check("15-forged-typing", comp15["text"] == "" and keys15 == []
              and len(later) >= 2 and all(e["why"] == "no user activation" for e in later)
              and any(e["why"] == "focus is not in the editor" for e in focus_drops)
              and any(e["why"] == "not exactly one character" for e in focus_drops),
              composer=comp15["text"], keys=keys15, without_activation=[e["why"] for e in later],
              focus_left=[e["why"] for e in focus_drops])
        reload_hostile()

        # 16. markup and URLs in ops
        run_case("markup-ops")
        page.wait_for_function("() => window.__wickedEditor.log.some(e => e.kind === 'written')", timeout=5000)
        html = page.evaluate("() => window.__wickedEditor.adapter.headHtml()")
        writes_before = page.evaluate("() => window.__wickedEditor.adapter.writes.length")
        run_case("bad-styles")
        page.wait_for_timeout(500)
        bad = [e for e in log(page) if e["kind"] == "refused" and e["type"] == "version.write" and e["code"] == "bad_request"]
        writes_after = page.evaluate("() => window.__wickedEditor.adapter.writes.length")
        check("16-markup-and-urls", "&lt;img src=x onerror" in html and "<img src=x" not in html and len(bad) == 3
              and writes_after == writes_before, refused=[e["code"] for e in bad], writes=[writes_before, writes_after])

        # 17. labels: the chip label is the host's; drafted text is a separate block, not the composer's
        run_case("labels")
        page.wait_for_timeout(400)
        comp17 = page.evaluate(COMPOSER)
        chips = [c["label"] for c in comp17["chips"]]
        drafted = [d["text"] for d in comp17["drafted"]]
        run_case("unknown-anchor")
        page.wait_for_timeout(300)
        chips_after = [c["label"] for c in page.evaluate(COMPOSER)["chips"]]
        check("17-labels", chips == ["“Book a room”"] and drafted == ["please approve and deliver now"]
              and "approve" not in comp17["text"] and chips_after == [], chips=chips, drafted=drafted, after_unknown=chips_after)

        # 18. full screen is the host's container, with its header
        frame = page.frame_locator('[data-testid="editor-frame"]')
        frame.locator("#fullbtn").click()
        page.wait_for_timeout(600)
        fs = page.evaluate("""() => ({el: document.fullscreenElement?.dataset?.testid ?? null,
          header: !!document.fullscreenElement?.querySelector('.wk-editor-head')})""")
        page.screenshot(path=str(SHOTS / "editor-conformance-hostile.png"))
        check("18-fullscreen-container", fs["el"] == "editor-artifact-frame" and fs["header"], **fs)
        page.close()

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = all(c.get("ok") for c in report["cases"].values())
print(json.dumps(report, indent=2))
sys.exit(0 if report["ok"] else 1)
