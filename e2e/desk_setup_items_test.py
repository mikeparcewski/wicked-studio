"""Studio's own setup on the landing (operator 2026-10-17: "if a user doesn't have any agents or memory should we seed
a message that they need to set up their agents?" — and "if user just installed it's not unreachable, just may not
have data"). Not a stored message: LIVE items from the roster and the memory read, gone once the state is fixed.
Home v2 (2026-10-26): the landing shows ONE card — "no agent can work" above everything, any other setup item only
when nothing needs you (headed "Set up studio").

States, each on a fresh Desk at 1440x700 (light and dark captured):
  fresh       no agent signed in, memory empty, one repository never indexed →
              the card is "Set up your agents — none can work yet (0 of N ready)" [Set up agents → the Agents
              tab's setup] (the memory item waits behind it);
  memory-empty agents fine, no memories → "Your memory is empty — …" [Build memory];
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
  setup: [...document.querySelectorAll('[data-testid="desk-card"][data-setup]')].map((e) => ({ key: e.dataset.setup, text: e.innerText,
    act: e.querySelector('[data-testid="desk-setup-act"]')?.innerText ?? null })),
})"""

ALL_OUT = {"claude": False, "codex": False, "agy": False, "pi": False}
# Home v2: a setup item other than "no agent can work" is the card only when nothing needs you, so those
# states run on the calm `wave1` corpus (working runs, no gate, no failure).
CALM = dict(wave1=True, gate_now=[], gate_simple=[], status_over={})
STATES = [
    ("fresh", dict(roster_signed_in=ALL_OUT, memory_total=0, memory_down=False, never_indexed=1)),
    ("memory-empty", dict(roster_signed_in={}, memory_total=0, memory_down=False, never_indexed=0, **CALM)),
    ("one-agent", dict(roster_signed_in={"agy": False}, memory_total=267, memory_down=False, never_indexed=0, **CALM)),
    ("memory-down", dict(roster_signed_in={}, memory_total=267, memory_down=True, never_indexed=0, **CALM)),
    ("healthy", dict(roster_signed_in={}, memory_total=267, memory_down=False, never_indexed=0, **CALM)),
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
        page.locator('[data-testid="desk-story"][data-count]').wait_for(state="visible", timeout=15000)
        page.wait_for_timeout(900)
        seen[name] = page.evaluate(ITEMS)
        for t in ("wicked-light", "wicked-dark"):
            page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", t)
            page.wait_for_timeout(150)
            page.get_by_test_id("desk-work").screenshot(path=str(SHOTS / f"desk-setup-items-{name}-{t}.png"))
        page.evaluate("() => document.documentElement.removeAttribute('data-theme')")

    f = seen["fresh"]
    keys = [s["key"] for s in f["setup"]]
    check("fresh", keys == ["agents"]
          and "none can work yet (0 of 4 ready)" in f["setup"][0]["text"] and f["setup"][0]["act"] == "Set up agents", fresh=f)
    e = seen["memory-empty"]
    check("memory-empty", [x["key"] for x in e["setup"]] == ["memory-empty"] and e["setup"][0]["act"] == "Build memory", empty=e)
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
    page.locator('[data-testid="desk-card"][data-setup="agents"] [data-testid="desk-setup-act"]').click()
    page.wait_for_function("() => new URLSearchParams(location.search).get('tab') === 'agents'", timeout=8000)
    at = page.evaluate("() => new URLSearchParams(location.search).get('at')")
    check("set-up-agents-opens-setup", at == "/agents?setup=1", at=at)
    set_fixture(origin, roster_signed_in={}, memory_total=267, memory_down=False, never_indexed=0, wave1=False)

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
