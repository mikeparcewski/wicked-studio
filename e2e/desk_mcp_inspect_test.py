#!/usr/bin/env python3
"""
desk_mcp_inspect_test.py — the MCP inspector (DES-MCP-INSPECTOR-001 §4-§5) at 1440x700 and 390x844.

Runs against the shared W2 fixture (uxfix_fixture.py) with `mcp_inspect` on: a stand-in for crew's
`/api/v1/mcp-inspect` bridge over a scripted fake MCP server (tools echo, add, boom), two registered
servers, and the third-party `acme-mcp` editor (kind `mcp-server`, e2e/editor-fixtures/mcp-inspector.html).

  1. MCP → a registered server's Inspect opens /mcp/inspect?server=<name>, the server preselected.
  2. A registered server connects WITHOUT a confirm; the plugin hears `mcp.state ready`, lists the
     tools through `mcp.request`, and the host's call line counts every call.
  3. Calling echo from the plugin (a real click) returns the text; boom answers the server's error;
     the call line names the last call; the plugin's log view shows the traffic.
  4. A tool call nobody clicked for is refused (`refused`) and never reaches the bridge; a list call
     without a click is fine.
  5. The plugin never sees the session id, the command or the URL (only the host's header does).
  6. Disconnect DELETEs the session; the plugin shows it as closed.
  7. A typed command asks first, naming the exact command; Cancel starts nothing; Run it connects.
  8. A command that dies before `initialize` shows Failed with the reason.
  9. Leaving the page deletes the session.
 10. Without the `mcp.session` grant, Connect is off and the page says the install consent grants it.
 11. No horizontal overflow at 1440x700 or 390x844.

Captures: e2e/shots/mcp-inspect-*.png. Env: FEEDBACK_PORT (default 4523). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.request

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4523"))
SHOTS = REPO / "e2e" / "shots"
report: dict = {"ok": False, "steps": {}}


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, default=str))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, default=str))
        sys.exit(1)


def posts() -> list:
    with urllib.request.urlopen(f"{origin}/__fixture/mcp-inspect-posts", timeout=10) as r:
        return json.loads(r.read())["posts"]


def overflow(page) -> int:
    return page.evaluate("document.documentElement.scrollWidth - innerWidth")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    ctx.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page = ctx.new_page()
    page.set_default_timeout(15000)
    set_fixture(origin, wave1=True, editors=True, shell_csp=True, mcp_inspect=True, mcp_inspect_grant=True, reset_mcp_inspect=True)

    def plugin():
        f = page.get_by_test_id("plugin-card").frame_locator('[data-testid="editor-frame"]')
        return f

    def plugin_frame():
        return page.get_by_test_id("plugin-card").get_by_test_id("editor-frame").element_handle().content_frame()

    # ── 1. the door from a server row ──────────────────────────────────────────────────
    page.goto(f"{origin}/mcp", wait_until="domcontentloaded")
    try:
        row = page.locator('[data-testid="mcp-server-row"][data-server="fixture-tools"]')
        row.wait_for(state="visible")
    except Exception:
        page.screenshot(path=str(SHOTS / "mcp-inspect-missing.png"))
        fail("mcp-row", page.locator("body").inner_text()[:2000])
    http_row = page.locator('[data-testid="mcp-server-row"][data-server="docs-http"] [data-testid="mcp-server-inspect"]')
    check("inspect-on-both-kinds", http_row.count() == 1 and row.get_by_test_id("mcp-server-inspect").count() == 1)
    check("inspector-link-in-header", page.get_by_test_id("mcp-inspector-link").count() == 1)
    row.get_by_test_id("mcp-server-inspect").click()
    page.wait_for_url("**/mcp/inspect?server=fixture-tools")
    page.get_by_test_id("mcp-inspect-ready").wait_for(state="visible")
    check("preselected", page.get_by_test_id("mcp-inspect-server").input_value() == "fixture-tools",
          rail=page.get_by_test_id("desk-rail-mcp").get_attribute("aria-current"))
    plugin().locator('[data-testid="plugin-status"]').wait_for(state="visible")
    check("plugin-not-connected", plugin().locator('[data-testid="plugin-status"]').inner_text() == "Not connected")

    # ── 2. a registered server: no confirm ────────────────────────────────────────────
    page.get_by_test_id("mcp-inspect-connect").click()
    page.locator('[data-testid="mcp-inspect-state"][data-state="ready"]').wait_for(state="visible")
    check("no-confirm-for-registry", page.get_by_test_id("mcp-inspect-confirm").count() == 0,
          starts=[x for x in posts() if x["kind"] == "start"])
    plugin().get_by_text("Connected to inspect-fixture").wait_for(state="visible")
    plugin().locator('[data-item="echo"]').wait_for(state="visible")
    page.wait_for_function("() => Number(document.querySelector('[data-testid=mcp-inspect-calls]').dataset.count) >= 3")
    calls = page.get_by_test_id("mcp-inspect-calls").inner_text()
    check("listed-through-the-host", "3 calls" in calls, calls=calls,
          rpcs=[x["body"]["method"] for x in posts() if x["kind"] == "rpc"])
    label = page.get_by_test_id("mcp-inspect-session-label").inner_text()
    check("host-header-names-the-command", label == "node fixtures/inspect-server.mjs", label=label)
    page.screenshot(path=str(SHOTS / "mcp-inspect-connected-1440.png"))

    # ── 3. a clicked call, and the server's error ─────────────────────────────────────
    plugin().locator('[data-item="echo"]').click()
    plugin().locator('input[data-arg="text"]').fill("hello inspector")
    plugin().locator('[data-testid="plugin-call"]').click()
    plugin().locator('[data-testid="plugin-result"]').get_by_text("hello inspector").wait_for(state="visible")
    page.wait_for_function("() => document.querySelector('[data-testid=mcp-inspect-calls]').textContent.includes('tools/call echo')")
    calls = page.get_by_test_id("mcp-inspect-calls").inner_text()
    sent = [x["body"] for x in posts() if x["kind"] == "rpc" and x["body"]["method"] == "tools/call"]
    check("echo-called", "4 calls" in calls and "7 ms" in calls and sent == [{"method": "tools/call", "params": {"name": "echo", "arguments": {"text": "hello inspector"}}}],
          calls=calls, sent=sent)
    page.screenshot(path=str(SHOTS / "mcp-inspect-called-1440.png"))
    plugin().locator('[data-item="boom"]').click()
    plugin().locator('[data-testid="plugin-call"]').click()
    plugin().locator('[data-testid="plugin-result"][data-error="1"]').wait_for(state="visible")
    page.wait_for_function("() => document.querySelector('[data-testid=mcp-inspect-calls]').textContent.includes('the server answered an error')")
    check("server-error-shown", "boom" in plugin().locator('[data-testid="plugin-result"]').inner_text())
    # The host renders Options and full-screen modes from the declaration. Card ↔ full keeps its frame.
    fr = plugin_frame()
    page.get_by_test_id("plugin-card-full").click()
    page.get_by_test_id("full-shell").wait_for(state="visible")
    page.locator('[data-testid="full-shell-mode"][data-mode="advanced"]').click()
    fr.wait_for_function("() => document.body.dataset.mode === 'advanced'")
    check("shared-full-modes", fr == plugin_frame()
          and page.locator('[data-testid="full-shell-mode"][data-mode="advanced"]').get_attribute("aria-checked") == "true")
    page.locator('[data-testid="full-shell-mode"][data-mode="simple"]').click()
    fr.wait_for_function("() => document.body.dataset.mode === 'simple'")
    page.get_by_test_id("full-shell-exit").click()
    fr.wait_for_function("() => document.body.dataset.surface === 'card'")

    page.get_by_test_id("plugin-card-options").click()
    panel = page.get_by_test_id("host-panel")
    panel.wait_for(state="visible")
    check("options-without-run", panel.get_by_role("tab", name="Run", exact=True).count() == 0)
    panel.get_by_role("tab", name="Resources", exact=True).click()
    options = panel.frame_locator('[data-testid="editor-frame"]')
    options.locator('[data-testid="plugin-status"][data-state="ready"]').wait_for(state="visible")
    options.locator('[data-item]').first.wait_for(state="visible")
    panel.get_by_role("tab", name="Log", exact=True).click()
    log = options.locator('[data-testid="plugin-log"]')
    log.wait_for(state="visible")
    text = log.inner_text()
    check("log-view", "initialize" in text and "tools/call" in text and "listening on stdio" in text, lines=log.locator("li").count())
    page.get_by_test_id("host-panel-close").click()

    # ── 4. no click, no tool call ─────────────────────────────────────────────────────
    fr = plugin_frame()
    # The host judges a click by the browser's transient user activation (about 5 s). The plugin fires
    # the call from a timer 7 s on, past the activation of the evaluate itself and of the clicks above.
    before = len([x for x in posts() if x["kind"] == "rpc"])
    fr.evaluate("() => window.__autoCall(7000)")
    fr.wait_for_function("() => window.__autoResult !== null", timeout=15000)
    got = fr.evaluate("() => window.__autoResult")
    listed = fr.evaluate("() => window.__listNow()")
    after = [x["body"]["method"] for x in posts() if x["kind"] == "rpc"][before:]
    calls = page.get_by_test_id("mcp-inspect-calls").inner_text()
    check("unclicked-call-refused", got == "refused" and listed == "ok" and after == ["tools/list"], got=got, listed=listed, after=after, calls=calls)

    # ── 5. what the plugin may see ────────────────────────────────────────────────────
    sid = [x for x in posts() if x["kind"] == "rpc"][0]["session"]
    frame_text = fr.evaluate("() => document.documentElement.outerHTML")
    check("plugin-never-sees-session-or-command", sid not in frame_text.replace("data-testid", "") and "inspect-server.mjs" not in frame_text,
          sid=sid)

    # ── 6. Disconnect ─────────────────────────────────────────────────────────────────
    page.get_by_test_id("mcp-inspect-disconnect").click()
    page.locator('[data-testid="mcp-inspect-state"][data-state="closed"]').wait_for(state="visible")
    plugin().locator('[data-testid="plugin-status"][data-stale="1"]').wait_for(state="visible")
    check("disconnect-deletes", any(x["kind"] == "delete" and x["session"] == sid for x in posts()))

    # ── 7. a typed command asks first ─────────────────────────────────────────────────
    page.get_by_test_id("mcp-inspect-restart").wait_for(state="visible")
    page.goto(f"{origin}/mcp/inspect", wait_until="domcontentloaded")
    page.get_by_test_id("mcp-inspect-pick-command").click()
    page.get_by_test_id("mcp-inspect-command").fill("node build/index.js --stdio")
    page.get_by_test_id("mcp-inspect-env").fill("API_TOKEN=s3cret-value")
    starts = len([x for x in posts() if x["kind"] == "start"])
    page.get_by_test_id("mcp-inspect-connect").click()
    q = page.get_by_test_id("mcp-inspect-confirm-text").inner_text()
    check("confirm-names-the-command", q == "Run node build/index.js --stdio on this machine as you, with API_TOKEN set?"
          and "s3cret" not in q, q=q)
    page.screenshot(path=str(SHOTS / "mcp-inspect-confirm-1440.png"))
    page.get_by_test_id("mcp-inspect-confirm-no").click()
    check("cancel-starts-nothing", len([x for x in posts() if x["kind"] == "start"]) == starts)
    page.get_by_test_id("mcp-inspect-connect").click()
    page.get_by_test_id("mcp-inspect-confirm-yes").click()
    page.locator('[data-testid="mcp-inspect-state"][data-state="ready"]').wait_for(state="visible")
    start = [x for x in posts() if x["kind"] == "start"][-1]["body"]
    meta = page.get_by_test_id("mcp-inspect-session-meta").inner_text()
    check("typed-command-runs", start == {"target": {"command": "node", "args": ["build/index.js", "--stdio"], "env": {"API_TOKEN": "s3cret-value"}}}
          and "env API_TOKEN" in meta and "s3cret" not in page.locator("body").inner_text(), start=start, meta=meta)

    # ── 9. leaving deletes it ─────────────────────────────────────────────────────────
    live_sid = [x for x in posts() if x["kind"] == "start"]
    deletes = len([x for x in posts() if x["kind"] == "delete"])
    page.get_by_test_id("mcp-inspect-back").click()
    page.wait_for_url("**/mcp")
    page.wait_for_timeout(800)
    check("leaving-deletes", len([x for x in posts() if x["kind"] == "delete"]) == deletes + 1)

    # ── 8. a server that dies before initialize ───────────────────────────────────────
    page.goto(f"{origin}/mcp/inspect", wait_until="domcontentloaded")
    page.get_by_test_id("mcp-inspect-pick-command").click()
    page.get_by_test_id("mcp-inspect-command").fill("node build/fail.js")
    page.get_by_test_id("mcp-inspect-connect").click()
    page.get_by_test_id("mcp-inspect-confirm-yes").click()
    page.locator('[data-testid="mcp-inspect-state"][data-state="failed"]').wait_for(state="visible")
    err = page.get_by_test_id("mcp-inspect-session-error").inner_text()
    check("failed-before-initialize", "exited with code 1" in err, err=err)
    page.screenshot(path=str(SHOTS / "mcp-inspect-failed-1440.png"))
    check("no-overflow-1440", overflow(page) <= 0, overflow=overflow(page))

    # ── 10. no grant, no Connect ──────────────────────────────────────────────────────
    set_fixture(origin, mcp_inspect_grant=False)
    page.goto(f"{origin}/mcp/inspect?server=fixture-tools", wait_until="domcontentloaded")
    page.get_by_test_id("mcp-inspect-not-granted").wait_for(state="visible")
    check("not-granted", page.get_by_test_id("mcp-inspect-connect").is_disabled(),
          words=page.get_by_test_id("mcp-inspect-not-granted").inner_text())
    set_fixture(origin, mcp_inspect_grant=True)

    # ── 11. the phone ─────────────────────────────────────────────────────────────────
    phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    pp = phone.new_page()
    pp.set_default_timeout(15000)
    pp.goto(f"{origin}/mcp/inspect?server=fixture-tools", wait_until="domcontentloaded")
    pp.get_by_test_id("mcp-inspect-connect").click()
    pp.locator('[data-testid="mcp-inspect-state"][data-state="ready"]').wait_for(state="visible")
    pp.frame_locator('[data-testid="editor-frame"]').locator('[data-item="echo"]').wait_for(state="visible")
    pp.screenshot(path=str(SHOTS / "mcp-inspect-connected-390.png"), full_page=True)
    check("no-overflow-390", overflow(pp) <= 0, overflow=overflow(pp))
    phone.close()
    browser.close()

report["ok"] = all(s["ok"] for s in report["steps"].values())
print(json.dumps(report, indent=2, default=str))
sys.exit(0 if report["ok"] else 1)
