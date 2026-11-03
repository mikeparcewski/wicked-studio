#!/usr/bin/env python3
"""
apps_runtime_test.py — DES-APPS-001 slice K4: the `wicked-apps` runtime in studio's plugin host, end to end, in ONE
browser engine per run (`--browser chromium|firefox|webkit`; CI runs chromium in the journeys and firefox + webkit in
the `apps runtime` job). Against the in-process fixture with the `apps` switch (e2e/apps_fixture.py: crew's app store
with its CAS and one undo pointer, and the query / prepare / run routes), at 1440x700 on the editor test page
`/editors/dev?editor=wicked-apps&…&kind=app&app=fixture-app`:

  1. S4 / S12: hostile row values and author text render as their characters (no element, no handler, nothing ran).
  2. CSSOM ONLY: the frame's DOM holds no `style` attribute (Preview, Edit, after a drag).
  3. S6: `fetch` from the app frame is refused by its CSP (`connect-src 'none'`); the fixture saw no request from it.
  4. S7: through the runtime's own port, a query app A does not hold (app B's) is refused by the host, and a field
     naming another app is a bad request: the fixture saw no query for it. An action asked with no click is refused.
  5. LINKS: `javascript:` and an unlisted host are refused by the host; a listed https host is shown in full first.
  6. THE CARD: Assign to me in Preview → the host draws the card outside the frame (operation, key, statement) and the
     fixture saw ONE prepare and NO run; Run is armed after a moment; Run → exactly one run, and the table re-reads.
     Cancel runs nothing.
  7. ONE VERSION PER BURST: in Edit, a drag (25 pointer moves, one op at its end) and a resize of the same component
     within the second land exactly one POST /edits (one version); the composer chip is the host's words for it.
  8. TWO TABS: undo in tab A, then undo in tab B from its stale version → B is told and re-reads; redo in B; A reads
     again on focus: both tabs show the same version, receipt and Undo / Redo state as the fixture's pointer.
  9. FRAMED: studio inside a same-origin page (which `frame-ancestors 'self'` allows) offers no action ("Open to make
     changes"), and a `data.action` sent straight to its host is refused with no prepare.
 10. PHONE (390x844): Preview only, "Edit on a larger screen", the grid in one column; still no `style` attribute.

Exit 0 and a JSON report on success. Captures: e2e/shots/apps-runtime-<browser>-*.png. Env: FEEDBACK_PORT.
"""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import apps_fixture
from uxfix_fixture import REPO, ensure_build, set_fixture, start_server

ap = argparse.ArgumentParser()
ap.add_argument("--browser", default=os.environ.get("APPS_BROWSER", "chromium"), choices=["chromium", "firefox", "webkit"])
args = ap.parse_args()
BROWSER = args.browser
PORT = int(os.environ.get("FEEDBACK_PORT", str(4391 + ["chromium", "firefox", "webkit"].index(BROWSER))))
SHOTS = REPO / "e2e" / "shots"
HOSTILE = ["<img src=x onerror=window.__pwned=1>", "javascript:alert(1)", "<script>window.__pwned=3</script>"]

report: dict = {"ok": False, "browser": BROWSER, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": str(why)[:2000]}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


def get_json(url: str):
    with urllib.request.urlopen(url, timeout=10) as res:
        return json.loads(res.read() or b"{}")


def post_json(url: str, body: dict):
    req = urllib.request.Request(url, method="POST", data=json.dumps(body).encode())
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read() or b"{}")


# Captures the port the host hands the runtime, in every frame, so a test can speak to the HOST as a hostile runtime
# would (the real bundle keeps its port in a closure; nothing in the product exposes it).
CAPTURE = """(() => {
  if (window.__k4cap) return; window.__k4cap = true; window.__k4replies = [];
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (d && d.type === 'host.hello' && e.ports && e.ports[0] && !window.__k4port) {
      window.__k4port = e.ports[0];
      window.__k4port.addEventListener('message', (m) => { if (m.data && typeof m.data.re === 'string' && m.data.re.startsWith('h')) window.__k4replies.push(m.data); });
    }
  }, true);
})();"""

HOSTILE_ASK = """async ([type, payload, id]) => {
  window.__k4port.postMessage({ p: 'wicked.editor', v: 1, type, id, payload });
  for (let i = 0; i < 100; i++) {
    const r = window.__k4replies.find((x) => x.re === id);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}"""


def calls(origin: str) -> list:
    return get_json(f"{origin}/__fixture/apps-calls")["calls"]


def count(origin: str, method: str, tail: str) -> int:
    return sum(1 for c in calls(origin) if c["method"] == method and c["path"].endswith(tail))


def app_frame(page, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        for f in page.frames:
            if "/api/v1/editors/wicked-apps/" in f.url:
                return f
        page.wait_for_timeout(100)  # the sync API takes frame events only inside its own calls
    fail("frame", f"no wicked-apps frame in {[f.url for f in page.frames]}")


def no_style(frame) -> int:
    return frame.evaluate("() => document.querySelectorAll('[style]').length")


def shot(page, name: str) -> None:
    SHOTS.mkdir(parents=True, exist_ok=True)
    # caret="initial": Playwright's caret hiding writes a style attribute into the frame's inputs, which this journey
    # counts as a failure of the runtime (§7.1). Leave the page untouched.
    page.screenshot(path=str(SHOTS / f"apps-runtime-{BROWSER}-{name}.png"), caret="initial")


def main() -> None:
    from playwright.sync_api import sync_playwright

    dist = ensure_build(fail)
    origin = start_server(PORT, dist)
    set_fixture(origin, editors=True, apps=True)
    post_json(f"{origin}/__fixture/apps-reset", {})
    reg = get_json(f"{origin}/api/v1/editors")
    entry = next((e for e in reg["editors"] if e["id"] == "wicked-apps"), None)
    # The fixture's own binding check covers a query-backed select's parameters (codex r2): a stand-in that let such a
    # spec land could not show that studio's defaults survive crew's rule.
    probe = json.loads(json.dumps(apps_fixture.SPEC_A))
    probe["queries"].append({"id": "teams", "source": "s", "kind": "sql", "params": {"type": "object", "properties": {"org": {"type": "string"}}, "required": ["org"]}, "output": [{"name": "t", "type": "string"}]})
    probe["pages"][0]["components"].append({"id": "team", "type": "filter", "filter": "select", "options": {"kind": "query", "query": {"query": "teams"}, "value": "t"}, "box": {"x": 0, "y": 20, "w": 3, "h": 1}})
    check("fixture_checks", [f["code"] for f in apps_fixture._check(probe)] == ["unbound_param"])
    check("registry", entry is not None and entry["kinds"] == ["app"], kinds=entry and entry["kinds"],
          permissions=entry and [p["id"] for p in entry["permissions"]])
    q = urllib.parse.urlencode({"editor": "wicked-apps", "version": entry["version"], "sha": entry["sha256"], "title": "App", "kind": "app", "app": "fixture-app"})
    url = f"/editors/dev?{q}"

    with sync_playwright() as p:
        browser = getattr(p, BROWSER).launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 700})
        ctx.add_init_script(CAPTURE)
        errors: list = []
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(origin + url)
        frame = app_frame(page)
        frame.wait_for_selector(".wk-table tbody tr >> nth=3", timeout=20_000)
        page.wait_for_selector('[data-testid="apps-version"]')
        shot(page, "1-preview")

        # 1. S4 / S12
        cells = frame.eval_on_selector_all(".wk-table tbody td:nth-child(2)", "els => els.map(e => e.textContent)")
        text = frame.eval_on_selector(".wk-text", "e => e.textContent")
        elements = frame.evaluate("() => document.querySelectorAll('[data-testid=apps-runtime] img, [data-testid=apps-runtime] script, [data-testid=apps-runtime] b').length")
        handlers = frame.evaluate("() => [...document.querySelectorAll('*')].flatMap(e => e.getAttributeNames().filter(a => a.startsWith('on'))).length")
        pwned = frame.evaluate("() => window.__pwned === undefined ? null : window.__pwned")
        check("s4_s12_text", cells[:3] == HOSTILE and text.endswith(HOSTILE[0]) and elements == 0 and handlers == 0 and pwned is None,
              cells=cells, text=text, elements=elements, handlers=handlers, pwned=pwned)

        # 2. CSSOM only
        check("cssom_preview", no_style(frame) == 0, style_attrs=frame.evaluate("() => [...document.querySelectorAll('[style]')].map(e => e.outerHTML.slice(0, 200))"))

        # 3. S6: the frame cannot reach crew
        before = len(calls(origin))
        fetched = frame.evaluate("""async () => { try { await fetch('/api/v1/apps/fixture-app'); return 'reached'; } catch (e) { return 'refused: ' + e.name; } }""")
        xhr = frame.evaluate("""() => new Promise((res) => { try { const x = new XMLHttpRequest(); x.open('GET', '/api/v1/apps/fixture-app'); x.onload = () => res('reached'); x.onerror = () => res('refused'); x.send(); } catch (e) { res('refused: ' + e.name); } })""")
        page.wait_for_timeout(300)
        check("s6_no_fetch", fetched.startswith("refused") and xhr.startswith("refused") and len(calls(origin)) == before, fetch=fetched, xhr=xhr)

        # 4. S7 + no click, through the runtime's own port (before any click: no activation, no focus in the frame)
        r1 = frame.evaluate(HOSTILE_ASK, ["data.query", {"query": "b_secret"}, "h1"])
        r2 = frame.evaluate(HOSTILE_ASK, ["data.query", {"query": "open_count", "app": "other-app"}, "h2"])
        r3 = frame.evaluate(HOSTILE_ASK, ["data.action", {"action": "assign_to_me", "params": {"id": 4821}}, "h3"])
        r4 = frame.evaluate(HOSTILE_ASK, ["data.action", {"action": "assign_to_me", "params": {"id": 4821, "owner": "x"}}, "h4"])
        leaked = [c for c in calls(origin) if "other-app" in c["path"] or json.dumps(c.get("body")).find("b_secret") >= 0]
        prepares = count(origin, "POST", "/prepare")
        check("s7_and_no_click", r1 and r1["error"]["code"] == "refused" and r2 and r2["error"]["code"] == "bad_request"
              and r3 and r3["error"]["code"] == "refused" and r4 and r4["error"]["code"] in ("refused", "bad_request")
              and leaked == [] and prepares == 0, b_secret=r1, other_app=r2, no_click=r3, extra_param=r4, leaked=leaked, prepares=prepares)

        # 5. links
        frame.click('[data-component="jsurl"] .wk-link')
        frame.wait_for_selector('[data-testid="apps-notice"]:has-text("Script not opened")')
        js = frame.text_content('[data-testid="apps-notice"]')
        frame.click('[data-component="evil"] .wk-link')
        frame.wait_for_selector('[data-testid="apps-notice"]:has-text("Elsewhere not opened")')
        evil = frame.text_content('[data-testid="apps-notice"]')
        confirm_before = page.locator('[data-testid="apps-link-confirm"]').count()
        frame.click('[data-component="docs"] .wk-link')
        page.wait_for_selector('[data-testid="apps-link-confirm"]')
        shown_url = page.text_content('[data-testid="apps-link-url"]')
        page.click('[data-testid="apps-link-cancel"]')
        check("links", "only https" in js and "not one of the hosts" in evil and confirm_before == 0 and shown_url == "https://docs.example.com/guide",
              javascript=js, unlisted=evil, listed=shown_url)

        # 6. the card
        row = frame.locator(".wk-table tbody tr", has_text="Printer on fire")
        row.locator("button", has_text="Assign to me").click()
        page.wait_for_selector('[data-testid="apps-card"]')
        armed_at_first = page.get_attribute('[data-testid="apps-card-run"]', "data-armed")
        card = {k: page.text_content(f'[data-testid="apps-card-{k}"]') for k in ("operation", "key", "request", "source")}
        prepared, ran = count(origin, "POST", "/prepare"), count(origin, "POST", "/run")
        shot(page, "2-card")
        check("card_before_run", card["operation"] == "UPDATE support.tickets" and "id = 4824" in card["key"] and card["request"].startswith("UPDATE ONLY")
              and prepared == 1 and ran == 0 and armed_at_first == "false", card=card, prepared=prepared, ran=ran, armed_at_first=armed_at_first)
        page.wait_for_selector('[data-testid="apps-card-run"][data-armed="true"]')
        page.click('[data-testid="apps-card-run"]')
        page.wait_for_selector('[data-testid="apps-outcome"]')
        outcome = page.text_content('[data-testid="apps-outcome"]')
        frame.wait_for_function("() => [...document.querySelectorAll('.wk-table tbody tr')].some(r => r.textContent.includes('Printer on fire') && r.textContent.includes('priya@example.com'))", timeout=10_000)
        check("card_run", count(origin, "POST", "/run") == 1 and "Ran" in outcome, outcome=outcome, runs=count(origin, "POST", "/run"))
        frame.locator(".wk-table tbody tr", has_text="javascript:").locator("button", has_text="Assign to me").click()
        page.wait_for_selector('[data-testid="apps-card"]')
        page.click('[data-testid="apps-card-cancel"]')
        frame.wait_for_selector('[data-component="tickets"] .wk-status:has-text("Not run")')
        check("card_cancel", count(origin, "POST", "/run") == 1 and count(origin, "POST", "/prepare") == 2, runs=count(origin, "POST", "/run"))
        # The API action's card: the operation, every argument with where it comes from, the request as sent.
        frame.click('[data-component="ping"] button')
        page.wait_for_selector('[data-testid="apps-card"]')
        api_card = {"operation": page.text_content('[data-testid="apps-card-operation"]'), "rows": page.locator('[data-testid="apps-card-row"]').all_text_contents(),
                    "request": page.text_content('[data-testid="apps-card-request"]')}
        page.click('[data-testid="apps-card-cancel"]')
        frame.wait_for_selector('[data-testid="apps-notice"]:has-text("Ping: Not run")')
        check("api_card", api_card["operation"] == "POST /ping" and any("from the app" in r and "fixed by the app" in r for r in api_card["rows"])
              and api_card["request"].startswith("POST https://ops.example.com/ping") and count(origin, "POST", "/run") == 1, card=api_card)
        # A card that expires runs nothing; a card left open when the person switches to Edit runs nothing.
        post_json(f"{origin}/__fixture/apps-caps", {"recordMs": 1500})
        frame.locator(".wk-table tbody tr", has_text="javascript:").locator("button", has_text="Assign to me").click()
        page.wait_for_selector('[data-testid="apps-card"]')
        page.wait_for_selector('[data-testid="apps-card"]', state="detached", timeout=8_000)
        post_json(f"{origin}/__fixture/apps-caps", {"recordMs": 120000})
        frame.locator(".wk-table tbody tr", has_text="javascript:").locator("button", has_text="Assign to me").click()
        page.wait_for_selector('[data-testid="apps-card"]')
        page.click('[data-testid="apps-mode-edit"]')
        page.wait_for_selector('[data-testid="apps-card"]', state="detached", timeout=5_000)
        page.click('[data-testid="apps-mode-preview"]')
        check("card_expiry_and_edit_cancel", count(origin, "POST", "/run") == 1 and count(origin, "POST", "/prepare") == 5, runs=count(origin, "POST", "/run"), prepares=count(origin, "POST", "/prepare"))

        # 7. one version per edit burst: a drag (one op at pointerup) and a Properties change within the second land ONE
        # version; the chip is the host's words for the selected component.
        page.click('[data-testid="apps-mode-edit"]')
        frame.wait_for_selector(".wk-palette")
        edits0 = count(origin, "POST", "/edits")
        frame.click('[data-component="open_kpi"] .wk-kpi-value')
        frame.wait_for_selector('[data-testid="apps-properties"]')
        page.wait_for_selector('[data-testid="apps-chip"]')
        chip = page.text_content('[data-testid="apps-chip"]')
        box = frame.locator('[data-component="open_kpi"]').bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] / 2 + 200, box["y"] + box["height"] / 2 + 60, steps=25)
        style_mid = no_style(frame)
        page.mouse.up()
        # The second gesture of the same burst: drag the selected component's corner (well inside the 1 s window).
        frame.wait_for_function("() => { const c = document.querySelector('[data-component=open_kpi]'); return !!c && c.classList.contains('is-selected'); }")
        page.wait_for_timeout(150)
        hb = frame.locator('[data-component="open_kpi"] .wk-handle').bounding_box()
        page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
        page.mouse.down()
        page.mouse.move(hb["x"] + 70, hb["y"] + 70, steps=8)
        page.mouse.up()
        page.wait_for_timeout(2_200)
        edits = [c for c in calls(origin) if c["method"] == "POST" and c["path"].endswith("/edits")][edits0:]
        page.wait_for_selector('[data-testid="apps-version"]:has-text("v2")')
        shot(page, "3-edit")
        moved = edits[0]["body"]["ops"][0]["spec"]["pages"][0]["components"] if edits else []
        kpi = next((c for c in moved if c["id"] == "open_kpi"), {})
        check("burst_one_version", len(edits) == 1 and kpi.get("box", {}).get("x", 0) > 0 and (kpi.get("box", {}).get("h", 2) > 2 or kpi.get("box", {}).get("w", 3) > 3) and style_mid == 0 and no_style(frame) == 0
              and chip == "about: KPI “Open” (Main, v1)", edits=len(edits), kpi_box=kpi.get("box"), style_during_drag=style_mid, chip=chip)

        # 7b. a title typed and then left with a click on studio's own Preview still lands (it commits as focus leaves)
        title = frame.locator('[data-prop="title"]')
        title.click()
        title.press("ControlOrMeta+a")
        title.press_sequentially("Open now")
        page.click('[data-testid="apps-mode-preview"]')
        page.wait_for_timeout(2_500)
        last = [c for c in calls(origin) if c["method"] == "POST" and c["path"].endswith("/edits")][-1]
        landed_title = next((c.get("title") for c in last["body"]["ops"][0]["spec"]["pages"][0]["components"] if c["id"] == "open_kpi"), None)
        check("typed_then_left", last["status"] == 200 and landed_title == "Open now", title=landed_title, status=last["status"])
        page.click('[data-testid="apps-mode-edit"]')

        # 8. two tabs
        h = get_json(f"{origin}/api/v1/apps/fixture-app")["app"]["head"]["version"]
        page_b = ctx.new_page()
        page_b.on("pageerror", lambda e: errors.append(str(e)))
        page_b.goto(origin + url)
        page_b.wait_for_selector(f'[data-testid="apps-version"]:has-text("v{h}")')
        page.click('[data-testid="apps-undo"]')
        page.wait_for_selector(f'[data-testid="apps-version"]:has-text("v{h + 1}")')
        page_b.click('[data-testid="apps-undo"]')
        page_b.wait_for_selector(f'[data-testid="apps-version"]:has-text("v{h + 1}")')
        b_status = page_b.text_content('[data-testid="apps-status"]') or ""
        page_b.wait_for_selector('[data-testid="apps-redo"]:not([disabled])')
        page_b.click('[data-testid="apps-redo"]')
        page_b.wait_for_selector(f'[data-testid="apps-version"]:has-text("v{h + 2}")')
        page.bring_to_front()
        page.evaluate("() => window.dispatchEvent(new Event('focus'))")
        page.wait_for_selector(f'[data-testid="apps-version"]:has-text("v{h + 2}")')
        state = lambda pg: (pg.text_content('[data-testid="apps-version"]'), pg.is_disabled('[data-testid="apps-undo"]'), pg.is_disabled('[data-testid="apps-redo"]'))
        fixture_app = get_json(f"{origin}/api/v1/apps/fixture-app")["app"]
        undo_posts = [(c["body"].get("base"), c["status"]) for c in calls(origin) if c["path"].endswith("/undo")]
        check("two_tabs_agree", state(page) == state(page_b) and fixture_app["head"]["version"] == h + 2 and fixture_app["history"]["canRedo"] is False
              and undo_posts == [(h, 200), (h, 409)] and "another tab" in b_status,
              a=state(page), b=state(page_b), b_told=b_status, undo_posts=undo_posts, pointer=fixture_app["history"])
        page_b.close()

        # 8b. a card whose action changed meanwhile (another writer) runs nothing: crew refuses the record, said "failed"
        page.click('[data-testid="apps-mode-preview"]')
        frame.locator(".wk-table tbody tr", has_text="javascript:").locator("button", has_text="Assign to me").click()
        page.wait_for_selector('[data-testid="apps-card"]')
        cur = get_json(f"{origin}/api/v1/apps/fixture-app")["app"]
        changed = json.loads(json.dumps(cur["spec"]))
        changed["actions"][0]["set"] = {"owner": {"kind": "literal", "value": "someone-else"}}
        post_json(f"{origin}/api/v1/apps/fixture-app/edits", {"base": cur["head"]["version"], "ops": [{"op": "spec", "spec": changed}], "summary": "elsewhere"})
        runs_before = count(origin, "POST", "/run")
        page.wait_for_selector('[data-testid="apps-card-run"][data-armed="true"]')
        page.click('[data-testid="apps-card-run"]')
        page.wait_for_selector('[data-testid="apps-outcome"]')
        stale_outcome = page.text_content('[data-testid="apps-outcome"]')
        refused_run = [c for c in calls(origin) if c["path"].endswith("/run")][-1]
        owner_kept = frame.evaluate("() => [...document.querySelectorAll('.wk-table tbody tr')].find(r => r.textContent.includes('javascript:'))?.textContent.includes('unassigned')")
        check("changed_action_runs_nothing", refused_run["status"] == 409 and count(origin, "POST", "/run") == runs_before + 1 and "failed" in stale_outcome and owner_kept,
              outcome=stale_outcome, status=refused_run["status"])

        # 9. framed
        framer = ctx.new_page()
        framer.goto(f"{origin}/__fixture/apps-framer?{urllib.parse.urlencode({'src': url})}")
        end = time.time() + 20
        inner = None
        while time.time() < end and inner is None:
            inner = next((f for f in framer.frames if "/api/v1/editors/wicked-apps/" in f.url), None)
            framer.wait_for_timeout(100)
        if inner is None:
            fail("framed", "no app frame inside the framed studio")
        inner.wait_for_selector(".wk-td-actions", timeout=20_000)
        offered = inner.locator(".wk-td-actions button").count()
        says = inner.text_content(".wk-td-actions")
        p0 = count(origin, "POST", "/prepare")
        r5 = inner.evaluate(HOSTILE_ASK, ["data.action", {"action": "assign_to_me", "params": {"id": 4821}}, "h5"])
        # Studio's own chrome changes nothing in a frame either: Undo, Redo and Edit are not offered (codex r2 P1).
        studio = next((f for f in framer.frames if "/editors/dev" in f.url), None)
        chrome = studio.evaluate("() => ['apps-undo', 'apps-redo', 'apps-mode-edit'].map((t) => document.querySelector(`[data-testid=${t}]`)?.disabled)") if studio else None
        undo_before = len([c for c in calls(origin) if c["path"].endswith("/undo") or c["path"].endswith("/redo")])
        if studio is not None:
            studio.click('[data-testid="apps-undo"]', force=True)
            framer.wait_for_timeout(500)
        undo_after = len([c for c in calls(origin) if c["path"].endswith("/undo") or c["path"].endswith("/redo")])
        check("framed_refuses", offered == 0 and "Open to make changes" in says and r5 and r5["error"]["code"] == "refused"
              and "Open to make changes" in r5["error"]["message"] and count(origin, "POST", "/prepare") == p0
              and chrome == [True, True, True] and undo_after == undo_before, buttons=offered, says=says, sent=r5, chrome_disabled=chrome)
        framer.close()

        # 10. a window too narrow for the builder: the frame decides (under 640 px), so Edit is not offered
        mid = browser.new_context(viewport={"width": 1000, "height": 700})
        mp = mid.new_page()
        mp.goto(origin + url)
        app_frame(mp).wait_for_selector(".wk-table tbody tr", timeout=20_000)
        mp.wait_for_function("() => document.querySelector('[data-testid=apps-mode-edit]')?.disabled === true", timeout=5_000)
        check("narrow_frame_preview_only", mp.is_disabled('[data-testid="apps-mode-edit"]'))
        mid.close()

        # 11. phone
        phone = browser.new_context(viewport={"width": 390, "height": 844})
        pp = phone.new_page()
        pp.goto(origin + url)
        pf = app_frame(pp)
        pf.wait_for_selector(".wk-table tbody tr", timeout=20_000)
        lefts = pf.eval_on_selector_all(".wk-cell:not(.wk-cell--filter)", "els => [...new Set(els.map(e => Math.round(e.getBoundingClientRect().left)))]")
        shot(pp, "4-phone")
        check("phone", pp.is_disabled('[data-testid="apps-mode-edit"]') and pp.locator('[data-testid="apps-phone-note"]').count() == 1
              and len(lefts) == 1 and no_style(pf) == 0, lefts=lefts)
        phone.close()

        check("page_errors", errors == [], errors=errors[:5])
        browser.close()
    report["ok"] = True
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
