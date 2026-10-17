"""Studio's own setup in Needs you (operator 2026-10-17: "if a user doesn't have any agents or memory should we seed
a message that they need to set up their agents?" — and "if user just installed it's not unreachable, just may not
have data"). Not a stored message: LIVE items from the roster and the memory read, pinned at the top of the inbox
beside the per-agent sign-in chores, gone once the state is fixed.

States, each on a fresh Desk at 1440x700 (light and dark captured):
  fresh       no agent signed in, memory empty, one repository never indexed →
              "Set up your agents — none can work yet (0 of N signed in)" [Set up agents → the Agents tab's setup],
              "Your memory is empty — …" [Build memory], and the repository's "Not indexed yet" item [Index it ›];
  one-agent   only claude can work → "Only claude can work — jobs need a second agent to review the work" [Sign in another];
  memory-down the memory read refused → "Memory isn't reachable — …" with the daemon's reason;
  healthy     two agents, 267 memories, every repository indexed → none of these items.

Captures: e2e/shots/desk-setup-items-*.png. Env: FEEDBACK_PORT (default 4606).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4606"))
SHOTS = REPO / "e2e" / "shots"

report: dict = {"ok": False, "steps": {}}


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2))
        sys.exit(1)


dist = ensure_build(lambda step, why: check(step, False, error=why))
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
errors: list[str] = []

ITEMS = """() => ({
  setup: [...document.querySelectorAll('[data-testid="desk-setup"]')].map((e) => ({ key: e.dataset.setup, text: e.innerText,
    act: e.querySelector('[data-testid="desk-setup-act"]')?.innerText ?? null })),
  repo: [...document.querySelectorAll('[data-testid="need-row"][data-kind="repo-graph"]')].map((e) => e.innerText),
  first: document.querySelector('[data-testid="desk-inbox-list"]')?.firstElementChild?.dataset.testid ?? null,
})"""

ALL_OUT = {"claude": False, "codex": False, "agy": False, "pi": False}
STATES = [
    ("fresh", dict(roster_signed_in=ALL_OUT, memory_total=0, memory_down=False, never_indexed=1)),
    ("one-agent", dict(roster_signed_in={"agy": False}, memory_total=267, memory_down=False, never_indexed=0)),
    ("memory-down", dict(roster_signed_in={}, memory_total=267, memory_down=True, never_indexed=0)),
    ("healthy", dict(roster_signed_in={}, memory_total=267, memory_down=False, never_indexed=0)),
]

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    seen: dict = {}
    for name, sw in STATES:
        set_fixture(origin, **sw)
        page.goto(f"{origin}/", wait_until="networkidle")
        page.get_by_test_id("desk-inbox-count").wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(900)
        seen[name] = page.evaluate(ITEMS)
        for t in ("wicked-light", "wicked-dark"):
            page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", t)
            page.wait_for_timeout(150)
            page.get_by_test_id("desk-inbox").screenshot(path=str(SHOTS / f"desk-setup-items-{name}-{t}.png"))
        page.evaluate("() => document.documentElement.removeAttribute('data-theme')")

    f = seen["fresh"]
    keys = [s["key"] for s in f["setup"]]
    check("fresh", keys[:2] == ["agents", "memory-empty"] and f["first"] == "desk-chores"
          and "none can work yet (0 of 4 signed in)" in f["setup"][0]["text"] and f["setup"][0]["act"] == "Set up agents"
          and f["setup"][1]["act"] == "Build memory" and any("Not indexed yet" in r and "Index it" in r for r in f["repo"]), fresh=f)
    o = seen["one-agent"]
    check("one-agent", [s["key"] for s in o["setup"]] == ["second-agent"]
          and "Only claude can work — jobs need a second agent to review the work" in o["setup"][0]["text"]
          and o["setup"][0]["act"] == "Sign in another", one=o)
    m = seen["memory-down"]
    check("memory-down", [s["key"] for s in m["setup"]] == ["memory-down"] and "Memory isn’t reachable" in m["setup"][0]["text"]
          and "estate unreachable" in m["setup"][0]["text"], down=m)
    check("healthy", seen["healthy"]["setup"] == [], healthy=seen["healthy"])

    # The action goes where it says: "Set up agents" opens the Agents tab's setup steps.
    set_fixture(origin, **STATES[0][1])
    page.goto(f"{origin}/", wait_until="networkidle")
    page.locator('[data-testid="desk-setup"][data-setup="agents"] [data-testid="desk-setup-act"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('tab') === 'agents'", timeout=8000)
    at = page.evaluate("() => new URLSearchParams(location.search).get('at')")
    check("set-up-agents-opens-setup", at == "/agents?setup=1", at=at)
    set_fixture(origin, roster_signed_in={}, memory_total=267, memory_down=False, never_indexed=0)

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
