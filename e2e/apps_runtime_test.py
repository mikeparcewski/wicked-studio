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
  6b. LINES (studio#963): a line chart's series and the line over an area resolve to `fill: none` and an area has no
     outline, in this engine's own cascade; and in a screenshot of each chart, the series colour covers a line's
     pixels, not a filled shape's (decoded on a blank page's canvas).
  7. ONE VERSION PER BURST: in Edit, a drag (25 pointer moves, one op at its end) and a resize of the same component
     within the second land exactly one POST /edits (one version); the composer chip is the host's words for it.
  8. TWO TABS: undo in tab A, then undo in tab B from its stale version → B is told and re-reads; redo in B; A reads
     again on focus: both tabs show the same version, receipt and Undo / Redo state as the fixture's pointer.
  9. FRAMED: studio inside a same-origin page (which `frame-ancestors 'self'` allows) offers no action ("Open to make
     changes"), and a `data.action` sent straight to its host is refused with no prepare.
 10. PHONE (390x844): Preview only, "Edit on a larger screen", the grid in one column; still no `style` attribute.
 11. /apps: a dashboard of crew's apps (3-4 across at 1440, 2 at 1024, 1 at 390), names as text, no style attribute,
     no query sent for a tile; a card opens its app; Share says "not published" (Publish disabled, a studio link) or
     shows crew's published link; a title edited in place lands one version, Escape lands none.

Exit 0 and a JSON report on success. Captures: e2e/shots/apps-runtime-<browser>-*.png. Env: FEEDBACK_PORT.
"""

import argparse
import base64
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


def layout_checks(page, frame, width: int) -> None:
    """Rendered geometry, focus and refresh regression checks at desktop and phone sizes."""
    toggle = page.locator('[data-testid="app-panel-toggle"][aria-expanded="true"]')
    if width == 390 and toggle.count():
        toggle.click()
        page.wait_for_selector('[data-testid="app-panel"][data-collapsed="true"]')
    if width == 390:
        # studio#1119: no right gutter beside the app on a phone, the panel minimised or not.
        frame_w = page.evaluate("() => document.querySelector('.wk-apps-frame').getBoundingClientRect().width")
        check("phone_no_gutter", abs(frame_w - 390) <= 1, frame_width=frame_w)
    # Playwright scrolls the old button into view before clicking it. The runtime must keep
    # the replacement row scrolled, with the new active button visible and focused.
    frame.locator('.wk-pages .wk-page').last.click()
    frame.wait_for_selector('[data-component="cases"] .wk-table tbody tr', timeout=20_000)
    frame.wait_for_function("""() => document.querySelector(
        '[data-component="case_filter"] [aria-live]')?.textContent === '200 of 457'""")
    frame.wait_for_function("""() => {
        const nav = document.querySelector('.wk-pages').getBoundingClientRect();
        const active = document.querySelector('.wk-page.is-on').getBoundingClientRect();
        return active.left >= nav.left - 1 && active.right <= nav.right + 1;
    }""")
    geometry = frame.evaluate("""() => {
        const nav = document.querySelector('.wk-pages');
        const active = nav.querySelector('.is-on');
        const scroll = document.querySelector('[data-component="cases"] .wk-table-scroll');
        const token = scroll.querySelector('tbody td');
        const range = document.createRange();
        range.selectNodeContents(token);
        const lines = [...new Set([...range.getClientRects()].filter(r => r.width && r.height)
            .map(r => Math.round(r.top)))].length;
        const filter = document.querySelector('[data-component="case_filter"] .wk-cell-body');
        const body = filter.getBoundingClientRect();
        const controls = [...filter.querySelectorAll('select, input, [aria-live]')].map(e => {
            const r = e.getBoundingClientRect();
            return {width: r.width, height: r.height, top: r.top, bottom: r.bottom,
                inside: r.left >= body.left - 1 && r.right <= body.right + 1
                    && r.top >= body.top - 1 && r.bottom <= body.bottom + 1};
        });
        const last = filter.querySelector('select').lastElementChild;
        return {documentFits: document.scrollingElement.scrollWidth <= document.scrollingElement.clientWidth,
            tableScrolls: scroll.scrollWidth > scroll.clientWidth, token: token.textContent, lines,
            tabFocused: document.activeElement === active, tabScroll: nav.scrollLeft,
            controls, count: filter.querySelector('[aria-live]').textContent,
            lastOption: last.textContent, lastDisabled: last.disabled};
    }""")
    if width == 1440:
        # A three-column filter: the search keeps at least 6ch of room and every visible control stays in the cell.
        narrow = frame.evaluate("""() => {
            const body = document.querySelector('[data-component="case_filter_narrow"] .wk-cell-body').getBoundingClientRect();
            const s = document.querySelector('[data-component="case_filter_narrow"] input[type="search"]').getBoundingClientRect();
            const shown = [...document.querySelectorAll('[data-component="case_filter_narrow"] select, [data-component="case_filter_narrow"] input')]
                .map(e => e.getBoundingClientRect());
            const sel = document.querySelector('[data-component="case_filter_narrow"] select').getBoundingClientRect();
            const status = document.querySelector('[data-component="status_filter"] .wk-filter-label').getBoundingClientRect();
            return {search: s.width, select: sel.width, overlap: sel.right - s.left, statusLabel: status.width,
                inside: shown.every(r => r.left >= body.left - 1 && r.right <= body.right + 1
                && r.top >= body.top - 1 && r.bottom <= body.bottom + 1)};
        }""")
        check("narrow_filter_search", narrow["search"] >= 48 and narrow["select"] >= 48 and narrow["overlap"] <= 0
              and narrow["inside"] and narrow["statusLabel"] > 20, **narrow)
    check(f"layout_{width}", geometry["documentFits"] and (width != 390 or geometry["tableScrolls"])
          and geometry["token"] == "CASE-A00224" and geometry["lines"] == 1
          and geometry["tabFocused"] and (width != 390 or geometry["tabScroll"] > 0)
          and len(geometry["controls"]) == 3
          and all(c["inside"] and c["width"] > 0 and c["height"] > 0 for c in geometry["controls"])
          and (width != 1440 or max(c["top"] for c in geometry["controls"])
               < min(c["bottom"] for c in geometry["controls"]))
          and geometry["count"] == "200 of 457" and geometry["lastDisabled"]
          and geometry["lastOption"] == "Showing 200 of 457: search to narrow", **geometry)

    search = frame.locator('[data-component="case_filter"]').get_by_role('searchbox', name='Search Case options', exact=True)
    search.fill('CASE-A0032')
    search.evaluate("e => e.setSelectionRange(2, 7, 'backward')")
    # Programmatic change refreshes queries while leaving keyboard focus in option search.
    frame.evaluate("() => { window.__layoutSearch = document.activeElement; }")
    frame.locator('[data-component="case_filter"] select').evaluate("e => e.dispatchEvent(new Event('change', {bubbles:true}))")
    frame.wait_for_function("() => document.querySelector('.wk-filter-options input') !== window.__layoutSearch")
    focus = search.evaluate("""e => ({focused: document.activeElement === e, value: e.value,
        start: e.selectionStart, end: e.selectionEnd, direction: e.selectionDirection})""")
    check(f"option_focus_{width}", focus == {"focused": True, "value": "CASE-A0032", "start": 2, "end": 7, "direction": "backward"}, **focus)
    search.evaluate('e => e.blur()')
    frame.evaluate("() => { window.__layoutSearch = document.querySelector('.wk-filter-options input'); }")
    frame.locator('[data-component="case_filter"] select').evaluate("e => e.dispatchEvent(new Event('change', {bubbles:true}))")
    frame.wait_for_function("() => document.querySelector('.wk-filter-options input') !== window.__layoutSearch")
    check(f"option_no_focus_steal_{width}", search.evaluate('e => document.activeElement !== e'))
    shot(page, f"layout-{width}")


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

        # 6b. studio#963: a line chart draws lines. The series rules set fill AND stroke; the role rules must win in
        # this engine's cascade (the presentation attribute fill="none" loses to any rule). After the card steps, not
        # before S6: S6 counts every request, and the host re-reads the app on a 5 s timer (codex r1).
        # The charts' query lands on its own: wait for every mark before reading a style (codex r1), and first for the
        # runtime to take the Preview click above, or the waits match Edit's marks that Preview then redraws (codex r2).
        frame.wait_for_selector('.wk-app[data-mode="preview"]', timeout=10_000)
        frame.wait_for_selector('[data-component="trend"] polyline.wk-stroke >> nth=1', timeout=10_000)
        frame.wait_for_selector('[data-component="trend_area"] polyline.wk-stroke', timeout=10_000)
        frame.wait_for_selector('[data-component="trend_area"] path.wk-area', timeout=10_000)
        marks = frame.evaluate("""() => {
            const css = (sel, prop) => [...document.querySelectorAll(sel)].map((e) => getComputedStyle(e)[prop]);
            return {
                line_fill: css('[data-component="trend"] polyline.wk-stroke', 'fill'),
                over_area_fill: css('[data-component="trend_area"] polyline.wk-stroke', 'fill'),
                area_stroke: css('[data-component="trend_area"] path.wk-area', 'stroke'),
                colour: css('[data-component="trend"] polyline.wk-series-0', 'stroke')[0] || '',
            };
        }""")
        # The pixel side: the share of each chart's screenshot painted in the series colour. A 2.5px line is under 1% of
        # the plot; the bug's filled shape (the line closed back to its first point) is 25-35% of it. The area chart's
        # own fill is not counted only because `.wk-area` paints it at opacity .25, far from the full colour.
        def painted(component: str) -> float:
            png = frame.locator(f'[data-component="{component}"] svg').screenshot(caret="initial")
            (SHOTS / f"apps-runtime-{BROWSER}-1b-{component}.png").write_bytes(png)
            blank = ctx.new_page()
            try:
                return blank.evaluate("""async ([b64, colour]) => {
                    const img = new Image();
                    img.src = 'data:image/png;base64,' + b64;
                    await img.decode();
                    const c = document.createElement('canvas');
                    c.width = img.naturalWidth;
                    c.height = img.naturalHeight;
                    const g = c.getContext('2d');
                    g.drawImage(img, 0, 0);
                    const d = g.getImageData(0, 0, c.width, c.height).data;
                    const [r, gr, b] = (colour.match(/[0-9.]+/g) || []).map(Number);
                    let hit = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        if (Math.abs(d[i] - r) < 24 && Math.abs(d[i + 1] - gr) < 24 && Math.abs(d[i + 2] - b) < 24) hit += 1;
                    }
                    return hit / (c.width * c.height);
                }""", [base64.b64encode(png).decode(), marks["colour"]])
            finally:
                blank.close()
        line_share, area_share = painted("trend"), painted("trend_area")
        # Back to the top: later steps drag by viewport coordinates.
        frame.locator('[data-component="search"]').scroll_into_view_if_needed()
        check("lines_draw_unfilled", marks["line_fill"] == ["none", "none"] and marks["over_area_fill"] == ["none"]
              and marks["area_stroke"] == ["none"] and marks["colour"].startswith("rgb") and 0.001 < line_share < 0.08 and 0.001 < area_share < 0.08,
              **marks, line_share=round(line_share, 4), area_share=round(area_share, 4))

        # 7. one version per edit burst: a drag (one op at pointerup) and a Properties change within the second land ONE
        # version; the chip is the host's words for the selected component.
        page.click('[data-testid="apps-mode-edit"]')
        frame.wait_for_selector(".wk-palette")
        edits0 = count(origin, "POST", "/edits")
        frame.click('[data-component="open_kpi"] .wk-kpi-value')
        # Properties are the host's, in the app's side panel, for every crew app (DES-REPORT-DASHBOARDS-001 §2).
        page.wait_for_selector('[data-testid="app-properties"][data-component="open_kpi"]')
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
        title = page.locator('[data-testid="app-prop-title"]')
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

        # 9a. /apps: a dashboard of crew's apps (the fixture serves the store): the grid, the names as text, no style
        # attribute, and (K5) no query but the cards' own KPI reads
        # The earlier tab is closed first: its own refresh (it adopts step 8b's version and re-reads its queries) is not
        # the dashboard's, and only the dashboard's requests are counted.
        page.close()
        dash_wait = ctx.new_page()
        dash_wait.wait_for_timeout(500)
        dash_wait.close()
        q0 = count(origin, "POST", "/query")
        n0 = len(calls(origin))
        dash = ctx.new_page()
        dash.on("pageerror", lambda e: errors.append(str(e)))
        dash.goto(f"{origin}/apps")
        dash.wait_for_selector('[data-testid="apps-card"] >> nth=1', timeout=20_000)
        dash.wait_for_timeout(2_000)  # the tiles' frames load and draw
        names = dash.eval_on_selector_all('[data-testid="apps-card-name"]', "els => els.map(e => e.textContent)")
        nav_current = dash.get_attribute('[data-testid="nav-apps"]', "aria-current")
        cols = lambda pg: pg.evaluate("() => getComputedStyle(document.querySelector('[data-testid=apps-grid]')).gridTemplateColumns.split(' ').length")
        styled = dash.evaluate("() => document.querySelectorAll('[data-testid=apps-page] [style]').length")
        tile_frames = [f for f in dash.frames if "/api/v1/editors/wicked-apps/" in f.url]
        tile_styled = sum(f.evaluate("() => document.querySelectorAll('[style]').length") for f in tile_frames)
        pwned = dash.evaluate("() => window.__pwned === undefined ? null : window.__pwned")
        shot(dash, "5-dashboard")
        # K5: a card on screen reads its first page's KPI queries (live numbers) and nothing else: the previews read
        # nothing (they draw the last render's snapshot, and this page has none). Fixture desk's one KPI shows live.
        dash.wait_for_selector('[data-testid="apps-card"][data-slug="fixture-app"] [data-testid="apps-card-kpi-value"]', timeout=20_000)
        want = sorted(f"{slug_}:{c['data']['query']}" for slug_, spec_ in (("fixture-app", apps_fixture.SPEC_A), ("other-app", apps_fixture.SPEC_B))
                      for c in [x for x in spec_["pages"][0]["components"] if x["type"] == "kpi"][:3])
        got_reads = sorted(f"{c['path'].split('/')[4]}:{(c.get('body') or {}).get('query')}" for c in calls(origin)[n0:] if c["method"] == "POST" and c["path"].endswith("/query"))
        kpi_reads = len(want)
        tile_reads = len(got_reads)
        check("dashboard", sorted(names) == sorted(["Fixture desk", "<script>window.__pwned=5</script> Other app"]) and nav_current == "page"
              and 3 <= cols(dash) <= 4 and styled == 0 and len(tile_frames) == 2 and tile_styled == 0 and pwned is None
              and got_reads == want, names=names, nav=nav_current, columns=cols(dash), styled=styled, tiles=len(tile_frames), queries=got_reads, want=want, kpi_reads=kpi_reads, tile_reads=tile_reads)
        for w, want in ((1024, 2), (390, 1)):
            narrow = browser.new_context(viewport={"width": w, "height": 800})
            np_ = narrow.new_page()
            np_.goto(f"{origin}/apps")
            np_.wait_for_selector('[data-testid="apps-card"] >> nth=1', timeout=20_000)
            got = cols(np_)
            narrow.close()
            check(f"dashboard_{w}", got == want, columns=got)
        # Share, not published (other-app), from its card: plain words, Publish disabled, a studio link labelled as one
        dash.locator('[data-testid="apps-card"][data-slug="other-app"] [data-testid="apps-card-share"]').click()
        dash.wait_for_selector('[data-testid="apps-share"][data-published="false"]')
        unpub = {"publish_disabled": dash.is_disabled('[data-testid="apps-share-publish"]'), "studio": dash.input_value('[data-testid="apps-share-studio-field"]'),
                 "title": dash.text_content("#wk-share-title"), "link": dash.locator('[data-testid="apps-share-link-field"]').count()}
        dash.click('[data-testid="apps-share-close"]')
        check("share_unpublished", unpub["publish_disabled"] and unpub["studio"] == f"{origin}/apps/other-app" and unpub["link"] == 0
              and unpub["title"] == "Share “<script>window.__pwned=5</script> Other app”", **unpub)
        # A card opens its app (Preview), and its Share shows the published copy crew reports
        dash.locator('[data-testid="apps-card"][data-slug="fixture-app"] [data-testid="apps-card-open"]').click()
        dash.wait_for_url(f"{origin}/apps/fixture-app")
        af = app_frame(dash)
        af.wait_for_selector(".wk-table tbody tr", timeout=20_000)
        dash.click('[data-testid="apps-share-open"]')
        dash.wait_for_selector('[data-testid="apps-share"][data-published="true"]')
        pub = {"link": dash.input_value('[data-testid="apps-share-link-field"]'), "embed": dash.input_value('[data-testid="apps-share-embed-field"]'),
               "audience": dash.text_content('[data-testid="apps-share-audience"]')}
        dash.click('[data-testid="apps-share-close"]')
        check("card_opens_and_share_published", pub["link"] == "https://fixture-desk.apps.example.test/" and pub["embed"] == apps_fixture.PUBLISHED["fixture-app"]["snippet"]
              and pub["audience"] == "signed-in members of support-ops", **pub)

        # 9b. editing in place: a double-click on a title, Enter lands ONE version; Escape lands none; text stays text
        dash.goto(f"{origin}/apps/fixture-app?mode=edit")
        ef = app_frame(dash)
        ef.wait_for_selector(".wk-palette", timeout=20_000)
        hint = dash.text_content('[data-testid="apps-edit-hint"]')
        e0 = count(origin, "POST", "/edits")
        hostile_title = "<img src=x onerror=window.__pwned=9> Queue"
        # Selecting puts a chip on the host's line: the frame must not move between the two clicks (codex r9).
        frame_top = lambda: dash.eval_on_selector(".wk-apps-frame .wk-editor-frame", "e => e.getBoundingClientRect().top")
        top0 = frame_top()
        ef.click('[data-component="tickets"] .wk-cell-title')
        dash.wait_for_selector('[data-testid="apps-chip"]', timeout=5_000)
        top1 = frame_top()
        ef.dblclick('[data-component="tickets"] .wk-cell-title')
        field = ef.wait_for_selector('[data-testid="apps-inline"]')
        field.fill(hostile_title)
        field.press("Enter")
        dash.wait_for_timeout(2_200)
        e1 = count(origin, "POST", "/edits")
        shown_title = ef.text_content('[data-component="tickets"] .wk-cell-title')
        landed = [c for c in calls(origin) if c["method"] == "POST" and c["path"].endswith("/edits")][-1]
        landed_title = next((c.get("title") for c in landed["body"]["ops"][0]["spec"]["pages"][0]["components"] if c["id"] == "tickets"), None)
        ef.dblclick('[data-component="tickets"] .wk-cell-title')
        field = ef.wait_for_selector('[data-testid="apps-inline"]')
        field.fill("not this")
        field.press("Escape")
        dash.wait_for_timeout(1_600)
        e2 = count(origin, "POST", "/edits")
        after_escape = ef.text_content('[data-component="tickets"] .wk-cell-title')
        imgs = ef.evaluate("() => document.querySelectorAll('[data-testid=apps-runtime] img').length")
        shot(dash, "6-inline")
        # A Button's label, through the real host and crew's store (pi r9: the label op on a button).
        # force: the button is aria-disabled in Edit (inert), which Playwright reads as "not enabled"; a person's
        # double-click reaches it all the same.
        ef.dblclick('[data-component="ping"] button[data-inline]', force=True)
        field = ef.wait_for_selector('[data-testid="apps-inline"]')
        field.fill("Ping now")
        field.press("Enter")
        dash.wait_for_timeout(2_200)
        e3 = count(origin, "POST", "/edits")
        landed = [c for c in calls(origin) if c["method"] == "POST" and c["path"].endswith("/edits")][-1]
        landed_label = next((c.get("action", {}).get("label") for c in landed["body"]["ops"][0]["spec"]["pages"][0]["components"] if c["id"] == "ping"), None)
        check("inline_edit", hint == "Changes save as you make them · Undo to go back" and e1 - e0 == 1 and landed["status"] == 200 and landed_title == hostile_title
              and shown_title == hostile_title and e2 == e1 and after_escape == hostile_title and imgs == 0 and no_style(ef) == 0
              and top0 == top1 and e3 - e2 == 1 and landed_label == "Ping now"
              and ef.evaluate("() => window.__pwned === undefined"), hint=hint, landed=e1 - e0, after_escape_edits=e2 - e1, title=shown_title, imgs=imgs,
              frame_top=[top0, top1], label_edits=e3 - e2, label=landed_label)
        dash.close()

        # 9c. two touch taps on a Link's label open it in place in every engine (none fires dblclick for them: codex r9)
        touch = browser.new_context(viewport={"width": 1440, "height": 900}, has_touch=True)
        tp = touch.new_page()
        tp.goto(f"{origin}/apps/fixture-app?mode=edit")
        tf = app_frame(tp)
        tf.wait_for_selector(".wk-palette", timeout=20_000)
        tf.tap('[data-component="docs"] button[data-inline]', force=True)
        tp.wait_for_timeout(120)
        tf.tap('[data-component="docs"] button[data-inline]', force=True)
        opened = tf.wait_for_selector('[data-testid="apps-inline"]', timeout=3_000) is not None
        tapped_value = tf.input_value('[data-testid="apps-inline"]')
        tf.press('[data-testid="apps-inline"]', "Escape")
        check("inline_touch", opened and tapped_value == "Docs", value=tapped_value)
        touch.close()

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
        # A phone is view + chat (operator ruling D5): no Edit switch, Undo, Redo or Versions are drawn at all.
        check("phone", pp.locator('[data-testid="apps-mode-edit"]').count() == 0 and pp.locator('[data-testid="apps-undo"]').count() == 0
              and pp.locator('[data-testid="apps-versions-open"]').count() == 0 and pp.locator('[data-testid="apps-phone-note"]').count() == 1
              and len(lefts) == 1 and no_style(pf) == 0, lefts=lefts)
        layout_checks(pp, pf, 390)
        phone.close()

        desktop = browser.new_context(viewport={"width": 1440, "height": 700})
        dp = desktop.new_page()
        dp.goto(origin + url)
        df = app_frame(dp)
        df.wait_for_selector('.wk-table tbody tr', timeout=20_000)
        layout_checks(dp, df, 1440)
        desktop.close()

        check("page_errors", errors == [], errors=errors[:5])
        browser.close()
    report["ok"] = True
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
