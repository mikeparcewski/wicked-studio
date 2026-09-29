#!/usr/bin/env python3
"""
mcp_tools_test.py — MCP tools (DES-MCP-TOOLS-001 §7, slice S6) at 1440x700: paste → preview → save → approve.

Runs against the shared W2 fixture (uxfix_fixture.py) for the shell, with crew's `/api/v1/mcp/*`
wire (the registry, the policy preview and the approvals) and the steering rule reads EMULATED in
this rig by Playwright route handlers. The emulation decides cells the way the engine does
(wicked-core `mcp_gate::evaluate`; crew's tests/mcp-policies.test.ts proves the real preview equals
it cell by cell): D-1 denies a write in an evaluator or recon row, the first use of a server asks
until it is approved, then the mode decides (Gate every step asks for writes, Gate by risk asks for
an unapproved write, Auto runs).

  0. The rail carries "MCP tools" between Skills and Steering, and /mcp is its page (empty).
  1. Add existing server: name + command → Preview lists the three tools with their class and the
     decision matrix if saved now (every creator cell asks for first use; the writes are denied to
     evaluator and recon); nothing is registered yet.
  2. Save sends exactly that previewHash; the server row appears: "1 read ask · 2 write ask".
  3. Approve first use of the server → "1 read run · 2 write ask"; the wt_plain Policies matrix
     shows creator ask by MCP-POSTURE-WRITE and evaluator deny by engine:mcp-phase-role.
  4. Approve the tool → creator runs, evaluator is still denied (an approval never lifts D-1);
     the page has no horizontal overflow at 1440x700.
  4b. Wrap a REST API (slice S5a): kind "REST API (OpenAPI)" takes a base URL, the OpenAPI URL and
     a header secret; the preview lists each operation as a tool classed by its method and names
     the operations that could not be wrapped.
  5. Steering → Policies: the MCP chip filters to the MCP rules; Add ▾ → Add MCP policy lists the
     registered server in its Subject picker.
  6. Usage (slice S7): the server row says its calls over 7 days; MCP tools → Usage shows the calls,
     the decision split allow / ask / deny, p50/p95 and the chain, as crew's fold answers them for
     the rig's call records (hand-computed below); a tool drills down to seat × run, and a run opens
     its Governance panel. No horizontal overflow at 1440x700.

Captures: e2e/shots/mcp-tools-{preview,approved,rest,steering,usage}-<skin>.png. Skin: STUDIO_SKIN.
Env: FEEDBACK_PORT (default 4512). Prints a JSON report; exit 0/1.
"""

import json
import os
import sys
import urllib.parse

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, STUDIO_SKIN, ensure_build, set_fixture, start_server

PORT = int(os.environ.get("FEEDBACK_PORT", "4512"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
SEATS = ["claude", "codex", "opencode", "copilot", "pi", "agy"]
ROLES = ["creator", "evaluator", "recon"]
MODES = ["ask", "balanced", "autonomous"]
TOOLS = [
    {"name": "wt_echo", "annotations": {"readOnlyHint": True}, "class": "read"},
    {"name": "wt_note", "annotations": {"destructiveHint": True}, "class": "destructive"},
    {"name": "wt_plain", "annotations": None, "class": "write"},
]

REST_TOOLS = [
    {"name": "getIssue", "method": "GET", "path": "/issues/{id}", "annotations": {"readOnlyHint": True, "destructiveHint": False}, "class": "read"},
    {"name": "createIssue", "method": "POST", "path": "/issues", "annotations": {"readOnlyHint": False, "destructiveHint": False}, "class": "write"},
    {"name": "deleteIssue", "method": "DELETE", "path": "/issues/{id}", "annotations": {"readOnlyHint": False, "destructiveHint": True}, "class": "destructive"},
]

report: dict = {"ok": False, "skin": STUDIO_SKIN, "steps": {}}
mcp = {"servers": [], "approved": set(), "posts": [], "usage_queries": []}
RULES = [
    {"id": "PAT-001", "rule_type": "pattern", "statement": "Pin the fetch boundary", "severity": "warn",
     "confidence": 0.9, "targets": {}, "provenance": {"source": "ui", "source_kinds": ["doc"]}},
    {"id": "MCP-POSTURE-WRITE", "rule_type": "policy", "statement": "P-2: a write tool asks until approved",
     "severity": "warn", "confidence": 1.0, "targets": {}, "steering_type": "security", "applies_to": ["mcp"],
     "effect": "allow_with_conditions", "provenance": {"source": "filesystem", "source_kinds": ["doc"]}},
]


def fail(step: str, why) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2, default=str))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        print(json.dumps(report, indent=2, default=str))
        sys.exit(1)


def tool_view(server: str, t: dict) -> dict:
    return {"name": t["name"], "subject": f"mcp:{server}/{t['name']}", "description": f"{t['name']} tool",
            "annotations": t["annotations"], "inputSchema": {"type": "object"}, "derivedClass": t["class"],
            "classOverride": None, "class": t["class"], "enabled": True, "status": "registered",
            "schemaHash": f"h-{t['name']}", "observedSchemaHash": f"h-{t['name']}"}


def decide(server: str, t: dict, role: str, mode: str) -> tuple[str, list[str]]:
    subject = f"mcp:{server}/{t['name']}"
    write = t["class"] != "read"
    if write and role != "creator":
        return "deny", ["engine:mcp-phase-role"]
    if f"mcp:{server}" not in mcp["approved"] and subject not in mcp["approved"]:
        return "ask", ["engine:mcp-first-use"]
    if not write:
        return "allow", ["MCP-POSTURE-READ"]
    if mode == "ask":
        return "ask", ["MCP-MODE-ASK-WRITE"]
    if mode == "balanced" and subject not in mcp["approved"]:
        return "ask", ["MCP-POSTURE-WRITE"]
    return "allow", []


def policy_tool(server: str, t: dict) -> dict:
    subject = f"mcp:{server}/{t['name']}"
    cells = []
    for role in ROLES:
        for seat in SEATS:
            for mode in MODES:
                d, ids = decide(server, t, role, mode)
                cells.append({"role": role, "seat": seat, "mode": mode, "decision": d, "class": t["class"],
                              "ruleIds": ids, "obligations": ["mcp:approval"] if d == "ask" else [], "reason": None})
    ap = mcp["approved"]
    return {"subject": subject, "server": server, "tool": t["name"], "class": t["class"], "status": "registered",
            "enabled": True, "registered": True,
            "approval": {"firstUse": "server" if f"mcp:{server}" in ap else "tool" if subject in ap else None,
                         "write": "tool" if subject in ap else None},
            "cells": cells}


def matrix(servers: list[str]) -> dict:
    return {"roles": ROLES, "seats": SEATS, "modes": MODES, "phaseId": None, "withdrawOnSave": [],
            "tools": [policy_tool(s, t) for s in servers for t in TOOLS]}


def server_view(name: str) -> dict:
    return {"name": name, "kind": "mcp-stdio", "command": "npx", "args": ["-y", "@acme/jira-mcp"], "url": None,
            "auth": None, "authState": "none", "enabled": True,
            "health": {"state": "ok", "consecutiveFailures": 0, "checkedAt": "2026-09-28T18:00:00.000Z", "lastError": None},
            "registeredAt": "2026-09-28T18:00:00.000Z", "updatedAt": "2026-09-28T18:00:00.000Z",
            "tools": [tool_view(name, t) for t in TOOLS],
            "counts": {"total": 3, "enabled": 3, "registered": 3, "read": 1, "write": 1, "destructive": 1}}


def handle_mcp(route) -> None:
    req = route.request
    path = urllib.parse.urlparse(req.url).path[len("/api/v1"):]
    method = req.method
    body = json.loads(req.post_data) if req.post_data else None
    mcp["posts"].append({"method": method, "path": path, "body": body})

    def ok(payload, status=200):
        route.fulfill(status=status, content_type="application/json", body=json.dumps(payload))

    if path == "/mcp/servers" and method == "GET":
        return ok({"servers": [server_view(n) for n in mcp["servers"]], "discovered": []})
    if path == "/mcp/servers/preview" and body.get("kind") == "rest":
        name = body["name"]
        tools = [{**{k: v for k, v in tool_view(name, t).items() if k in ("name", "subject", "description", "annotations", "inputSchema", "class", "schemaHash")},
                  # crew classes a REST tool by its method (GET read, POST write, DELETE destructive);
                  # the rig answers the class crew would, and the page shows what it is given.
                  "rest": {"method": t["method"], "pathTemplate": t["path"], "pathMap": {"id": "id"} if "{id}" in t["path"] else {},
                           "queryMap": {}, "headerMap": {}, "bodyMap": {"title": "title"} if t["method"] == "POST" else None, "bodyArg": None,
                           "argAllowlist": ["id"] if "{id}" in t["path"] else ["title"], "timeoutMs": 30000}} for t in REST_TOOLS]
        pol = {"roles": ROLES, "seats": SEATS, "modes": MODES, "phaseId": None, "withdrawOnSave": [],
               "tools": [policy_tool(name, t) for t in REST_TOOLS]}
        return ok({"previewHash": f"ph-{name}", "expiresAt": "2099-01-01T00:00:00.000Z",
                   "server": {"name": name, "kind": "rest", "command": None, "args": [], "url": body.get("url"),
                              "auth": body.get("auth"), "openapiUrl": body.get("openapiUrl"), "operations": None},
                   "serverInfo": {"name": "Tracker API", "version": "1.2.0"}, "tools": tools, "diff": None,
                   "skipped": ["PUT /files: its request body is not JSON"], "policies": pol})
    if path == "/mcp/servers/preview":
        name = body["name"]
        tools = [{k: v for k, v in tool_view(name, t).items() if k in ("name", "subject", "description", "annotations", "inputSchema", "class", "schemaHash")} for t in TOOLS]
        pol = {"roles": ROLES, "seats": SEATS, "modes": MODES, "phaseId": None, "withdrawOnSave": [],
               "tools": [policy_tool(name, t) for t in TOOLS]}
        return ok({"previewHash": f"ph-{name}", "expiresAt": "2099-01-01T00:00:00.000Z",
                   "server": {"name": name, "kind": body["kind"], "command": body.get("command"), "args": body.get("args", []),
                              "url": None, "auth": body.get("auth")},
                   "serverInfo": {"name": "acme-jira", "version": "1.0.0"}, "tools": tools, "diff": None, "policies": pol})
    if path == "/mcp/servers" and method == "POST":
        name = body["previewHash"].removeprefix("ph-")
        mcp["servers"].append(name)
        return ok(server_view(name), 201)
    if path == "/mcp/policies/preview":
        return ok(matrix(mcp["servers"]))
    if path == "/mcp/approvals" and method == "GET":
        pending = []
        for s in mcp["servers"]:
            for t in TOOLS:
                subj = f"mcp:{s}/{t['name']}"
                needs = []
                if f"mcp:{s}" not in mcp["approved"] and subj not in mcp["approved"]:
                    needs.append("first-use")
                if t["class"] != "read" and subj not in mcp["approved"]:
                    needs.append("write")
                if needs:
                    pending.append({"subject": subj, "server": s, "tool": t["name"], "class": t["class"], "needs": needs})
        return ok({"approved": [], "pending": pending,
                   "ledgers": {"firstUse": {"id": "MCP-FIRST-USE", "present": True, "retired": False},
                               "write": {"id": "MCP-POSTURE-WRITE", "present": True, "retired": False}}})
    if path == "/mcp/usage" and method == "GET":
        mcp["usage_queries"].append(urllib.parse.urlparse(req.url).query)
        if not mcp["servers"]:
            return ok(usage_view({}) | {"totals": {"calls": 0, "decisions": dc(0, 0, 0), "ran": 0, "errors": 0, "errorRate": None,
                                                   "p50Ms": None, "p95Ms": None, "p99Ms": None}, "tools": [], "servers": [], "chains": []})
        return ok(usage_view(urllib.parse.parse_qs(urllib.parse.urlparse(req.url).query)))
    if path == "/mcp/approvals" and method == "POST":
        mcp["approved"].add(body["subject"])
        return ok({"subject": body["subject"], "approved": True, "rulesChanged": ["MCP-FIRST-USE"]})
    return ok({"error": f"mcp rig: no route {method} {path}"}, 404)


# Slice S7: the rig's call records, as crew's `GET /mcp/usage` folds them (crew tests/mcp-usage.test.ts
# pins that fold). c1 unit 1:1 (codex): wt_echo allow 12 ms → wt_note allow 48 ms; unit 2:1
# (claude, an evaluator): wt_echo allow 20 ms → wt_note denied by engine:mcp-phase-role; r-other (codex):
# wt_note asks. So 5 calls = 3 allowed, 1 asked, 1 denied; the 3 that ran sort 12 20 48, so nearest-rank
# p50 = 2nd = 20 ms and p95 = 3rd = 48 ms; the one chain is wt_echo → wt_note, twice, in one run.
def dc(a, k, d, g=0):
    return {"allow": a, "ask": k, "deny": d, "guard_error": g}


def usage_view(query: dict) -> dict:
    subject = (query.get("subject") or [None])[0]
    days = int((query.get("days") or ["7"])[0])
    echo = {"subject": "mcp:jira/wt_echo", "server": "jira", "tool": "wt_echo", "class": "read", "seats": ["claude", "codex"],
            "lastCall": "2026-09-28T17:00:00.000Z", "calls": 2, "decisions": dc(2, 0, 0), "ran": 2, "errors": 0,
            "errorRate": 0, "p50Ms": 12, "p95Ms": 20, "p99Ms": 20}
    note = {"subject": "mcp:jira/wt_note", "server": "jira", "tool": "wt_note", "class": "destructive", "seats": ["claude", "codex"],
            "lastCall": "2026-09-28T17:30:00.000Z", "calls": 3, "decisions": dc(1, 1, 1), "ran": 1, "errors": 0,
            "errorRate": 0, "p50Ms": 48, "p95Ms": 48, "p99Ms": 48}
    runs = [
        {"subject": "mcp:jira/wt_note", "seat": "codex", "runId": "r-other", "calls": 1, "decisions": dc(0, 1, 0), "errors": 0, "lastCall": "2026-09-28T17:30:00.000Z"},
        {"subject": "mcp:jira/wt_note", "seat": "claude", "runId": "c1", "calls": 1, "decisions": dc(0, 0, 1), "errors": 0, "lastCall": "2026-09-28T17:00:01.000Z"},
        {"subject": "mcp:jira/wt_note", "seat": "codex", "runId": "c1", "calls": 1, "decisions": dc(1, 0, 0), "errors": 0, "lastCall": "2026-09-28T16:00:01.000Z"},
    ]
    tools = [note] if subject == "mcp:jira/wt_note" else [echo, note]
    totals = ({k: note[k] for k in ("calls", "decisions", "ran", "errors", "errorRate", "p50Ms", "p95Ms", "p99Ms")} if tools == [note]
              else {"calls": 5, "decisions": dc(3, 1, 1), "ran": 3, "errors": 0, "errorRate": 0, "p50Ms": 20, "p95Ms": 48, "p99Ms": 48})
    daily = [{"day": f"2026-09-{d}", "calls": 0, "decisions": dc(0, 0, 0)} for d in range(21, 28)]
    daily.append({"day": "2026-09-28", "calls": totals["calls"], "decisions": totals["decisions"]})
    return {"days": days, "since": "2026-09-21T18:00:00.000Z", "until": "2026-09-28T18:00:00.000Z",
            "filters": {"subject": subject, "seat": None, "decision": None}, "totals": totals, "tools": tools,
            "servers": [{"server": "jira", "calls": totals["calls"], "decisions": totals["decisions"], "lastCall": "2026-09-28T17:30:00.000Z"}],
            "runs": runs if subject is not None else [], "chains": [{"from": "mcp:jira/wt_echo", "to": "mcp:jira/wt_note", "count": 2, "runs": 1}],
            "daily": daily if days == 7 else daily, "seats": ["claude", "codex"], "skipped": 0}


def handle_rules(route) -> None:
    if route.request.method == "GET":
        route.fulfill(status=200, content_type="application/json", body=json.dumps({"rules": RULES}))
    else:
        route.fallback()


def no_overflow(page) -> dict:
    return page.evaluate("""() => ({ docW: document.documentElement.scrollWidth, winW: window.innerWidth,
        main: (() => { const m = document.querySelector('[data-testid="mcp-tools-page"]');
                       return m ? { sw: m.scrollWidth, cw: m.clientWidth } : null; })() })""")


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.route("**/api/v1/mcp/**", handle_mcp)
    page.route("**/api/v1/governance/rules", handle_rules)
    set_fixture(origin, wave1=True)

    # ── 0. the nav entry, between Skills and Steering ────────────────────────────
    page.goto(f"{origin}/mcp", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("mcp-empty").wait_for(state="visible", timeout=15000)
    except Exception:
        page.screenshot(path=str(SHOTS / f"mcp-tools-missing-{STUDIO_SKIN}.png"))
        fail("page-shows", page.locator("body").inner_text()[:2000])
    nav = page.evaluate("""() => {
        const glyphs = [...document.querySelectorAll('[data-testid="rail-collapsed-glyph"]')].map(g => g.getAttribute('href'));
        const heads = [...document.querySelectorAll('[data-testid^="rail-heading-"]')].map(h => h.dataset.testid.slice('rail-heading-'.length));
        return { glyphs, heads }; }""")
    order = nav["glyphs"] if STUDIO_SKIN == "compact-rail" else nav["heads"]
    want = ["/skills", "/mcp", "/steering/dashboard"] if STUDIO_SKIN == "compact-rail" else ["skills", "mcp", "steering"]
    idx = [order.index(x) if x in order else -1 for x in want]
    check("nav-between-skills-and-steering", -1 not in idx and idx[1] == idx[0] + 1 and idx[2] == idx[1] + 1, nav=nav)

    # ── 1. paste → preview ────────────────────────────────────────────────────────
    page.get_by_test_id("mcp-add-open").click()
    page.get_by_test_id("mcp-add-name").fill("jira")
    page.get_by_test_id("mcp-add-target").fill("npx -y @acme/jira-mcp")
    page.get_by_test_id("mcp-add-preview").click()
    try:
        page.get_by_test_id("mcp-add-preview-result").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("preview", page.get_by_test_id("mcp-add-panel").inner_text())
    prev = page.evaluate("""() => [...document.querySelectorAll('[data-testid="mcp-add-preview-tool"]')].map(t => ({
        subject: t.dataset.subject, cls: t.dataset.class,
        cells: [...t.querySelectorAll('[data-testid="mcp-matrix-cell"]')].map(c => c.dataset.role + ':' + c.dataset.decision) }))""")
    note = next((t for t in prev if t["subject"] == "mcp:jira/wt_note"), None)
    check("preview-lists-tools-and-decisions",
          [t["subject"] for t in prev] == ["mcp:jira/wt_echo", "mcp:jira/wt_note", "mcp:jira/wt_plain"]
          and note is not None and note["cls"] == "destructive"
          and all(c == "creator:ask" for c in note["cells"][:6]) and all(c.endswith(":deny") for c in note["cells"][6:]),
          preview=prev)
    check("nothing-registered-before-save", not any(x["method"] == "POST" and x["path"] == "/mcp/servers" for x in mcp["posts"]))
    page.screenshot(path=str(SHOTS / f"mcp-tools-preview-{STUDIO_SKIN}.png"))

    # ── 2. save that preview ─────────────────────────────────────────────────────
    page.get_by_test_id("mcp-add-save").click()
    try:
        page.get_by_test_id("mcp-server-row").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("saved", page.locator("body").inner_text()[:2000])
    saves = [x["body"] for x in mcp["posts"] if x["method"] == "POST" and x["path"] == "/mcp/servers"]
    check("save-sends-the-preview-hash", saves == [{"previewHash": "ph-jira"}], saves=saves)
    page.wait_for_function("() => document.querySelector('[data-testid=\"mcp-server-posture\"]')?.textContent === '1 read ask · 2 write ask'", timeout=5000)
    check("posture-before-approval", True)

    # ── 3. approve first use ─────────────────────────────────────────────────────
    page.get_by_test_id("mcp-server-approve").click()
    try:
        page.wait_for_function("() => document.querySelector('[data-testid=\"mcp-server-posture\"]')?.textContent === '1 read run · 2 write ask'", timeout=5000)
    except Exception:
        fail("first-use-approved", page.get_by_test_id("mcp-server-row").inner_text())
    check("first-use-approved", mcp["approved"] == {"mcp:jira"})
    plain = page.locator('[data-testid="mcp-tool-row"][data-subject="mcp:jira/wt_plain"]')
    plain.get_by_test_id("mcp-tool-policies").click()

    def cell(role: str, seat: str) -> dict:
        return page.evaluate(f"""() => {{ const c = document.querySelector(
            '[data-testid="mcp-tool-row"][data-subject="mcp:jira/wt_plain"] [data-testid="mcp-matrix-cell"][data-role="{role}"][data-seat="{seat}"]');
            return c ? {{ d: c.dataset.decision, rules: [...c.querySelectorAll('[data-testid="mcp-cell-rule"]')].map(r => r.dataset.rule) }} : null; }}""")
    c1, c2 = cell("creator", "claude"), cell("evaluator", "codex")
    check("matrix-after-first-use",
          c1 == {"d": "ask", "rules": ["MCP-POSTURE-WRITE"]} and c2 == {"d": "deny", "rules": ["engine:mcp-phase-role"]},
          creator=c1, evaluator=c2)

    # ── 4. approve the tool ──────────────────────────────────────────────────────
    plain.get_by_test_id("mcp-tool-approve").click()
    try:
        page.wait_for_function("() => document.querySelector('[data-testid=\"mcp-server-posture\"]')?.textContent === '1 read run · 1 write run · 1 write ask'", timeout=5000)
    except Exception:
        fail("tool-approved", page.get_by_test_id("mcp-server-row").inner_text())
    c1, c2 = cell("creator", "claude"), cell("evaluator", "codex")
    check("approval-never-lifts-the-evaluator-gate", c1 is not None and c1["d"] == "allow" and c2 == {"d": "deny", "rules": ["engine:mcp-phase-role"]},
          creator=c1, evaluator=c2)
    ov = no_overflow(page)
    check("no-horizontal-overflow", ov["docW"] <= ov["winW"] and ov["main"] is not None and ov["main"]["sw"] <= ov["main"]["cw"], **ov)
    page.screenshot(path=str(SHOTS / f"mcp-tools-approved-{STUDIO_SKIN}.png"))

    # ── 4b. wrap a REST API (S5a) ────────────────────────────────────────────────
    page.get_by_test_id("mcp-add-open").click()
    page.get_by_test_id("mcp-add-kind").select_option("rest")
    page.get_by_test_id("mcp-add-name").fill("tracker")
    page.get_by_test_id("mcp-add-target").fill("https://api.example.com/v1")
    page.get_by_test_id("mcp-add-openapi-url").fill("https://api.example.com/openapi.json")
    page.get_by_test_id("mcp-add-auth-ref").fill("env:TRACKER_TOKEN")
    page.get_by_test_id("mcp-add-auth-into").fill("Authorization")
    page.get_by_test_id("mcp-add-preview").click()
    try:
        page.get_by_test_id("mcp-add-skipped").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("rest-preview", page.get_by_test_id("mcp-add-panel").inner_text())
    sent = [x["body"] for x in mcp["posts"] if x["path"] == "/mcp/servers/preview"][-1]
    rest_prev = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"mcp-add-preview-tool\"]')].map(t => [t.dataset.subject, t.dataset.class])")
    check("rest-preview-shows-each-operation-and-class",
          sent == {"name": "tracker", "kind": "rest", "url": "https://api.example.com/v1", "openapiUrl": "https://api.example.com/openapi.json",
                   "auth": {"ref": "env:TRACKER_TOKEN", "header": "Authorization"}}
          and rest_prev == [["mcp:tracker/getIssue", "read"], ["mcp:tracker/createIssue", "write"], ["mcp:tracker/deleteIssue", "destructive"]]
          and "PUT /files" in page.get_by_test_id("mcp-add-skipped").inner_text()
          and page.get_by_test_id("mcp-add-panel").locator("h3").inner_text() == "Wrap a REST API",
          sent=sent, preview=rest_prev)
    ov = no_overflow(page)
    check("rest-no-horizontal-overflow", ov["docW"] <= ov["winW"], **ov)
    page.get_by_test_id("mcp-add-panel").scroll_into_view_if_needed()
    page.screenshot(path=str(SHOTS / f"mcp-tools-rest-{STUDIO_SKIN}.png"))
    page.get_by_test_id("mcp-add-cancel").click()

    # ── 5. Steering: the MCP filter and the Subject picker ───────────────────────
    page.goto(f"{origin}/steering/policies?mcp=1", wait_until="domcontentloaded")
    try:
        page.get_by_test_id("steering-mcp-chip").wait_for(state="visible", timeout=15000)
        page.wait_for_function("() => document.querySelectorAll('[data-testid=\"steering-grid-row\"]').length === 1", timeout=5000)
    except Exception:
        fail("steering-mcp-filter", page.locator("body").inner_text()[:2000])
    rows = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"steering-grid-row\"]')].map(r => r.dataset.ruleId)")
    check("steering-mcp-filter", rows == ["MCP-POSTURE-WRITE"]
          and page.get_by_test_id("steering-mcp-chip").get_attribute("data-active") == "true", rows=rows)
    page.get_by_test_id("steering-add-menu").click()
    page.get_by_test_id("steering-add-mcp").click()
    try:
        page.locator('[data-testid="steering-mcp-server"] option[value="jira"]').wait_for(state="attached", timeout=5000)
    except Exception:
        fail("subject-picker", page.get_by_test_id("steering-rule-form").inner_text())
    page.get_by_test_id("steering-mcp-server").select_option("jira")
    page.get_by_test_id("steering-mcp-tool").select_option("wt_note")
    page.get_by_test_id("steering-mcp-add-subject").click()
    chips = page.evaluate("() => [...document.querySelectorAll('[data-testid=\"steering-form-applies-chip\"]')].map(c => c.textContent.replace('×', ''))")
    check("subject-picker-fills-applies-to", chips == ["mcp:jira/wt_note"], chips=chips)
    page.screenshot(path=str(SHOTS / f"mcp-tools-steering-{STUDIO_SKIN}.png"))

    # ── 6. Usage (slice S7) ──────────────────────────────────────────────────────
    page.goto(f"{origin}/mcp", wait_until="domcontentloaded")
    try:
        page.wait_for_function("() => (document.querySelector('[data-testid=\"mcp-server-usage\"]')?.textContent ?? '').startsWith('5 calls in 7 d · last used ')", timeout=15000)
    except Exception:
        fail("server-row-usage", page.locator("body").inner_text()[:2000])
    check("server-row-usage", True)
    page.locator('[data-testid="mcp-view-tab"][data-view="usage"]').click()
    try:
        page.get_by_test_id("mcp-usage-tools").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("usage-view", page.locator("body").inner_text()[:2000])
    tiles = page.evaluate("""() => Object.fromEntries(['calls', 'decisions', 'error-rate', 'p50', 'p95'].map(k =>
        [k, document.querySelector(`[data-testid="mcp-usage-${k}-value"]`)?.textContent]))""")
    split = page.evaluate("""() => [...document.querySelectorAll('[data-testid="mcp-usage-split"]')].map(s => s.dataset.decision + '=' + s.dataset.count)""")
    chains = page.evaluate("""() => [...document.querySelectorAll('[data-testid="mcp-usage-chain"]')].map(c => c.dataset.from + '>' + c.dataset.to + ':' + c.dataset.count)""")
    check("usage-tiles-split-chains",
          page.url.endswith("/mcp?view=usage")
          and tiles == {"calls": "5", "decisions": "60%", "error-rate": "0%", "p50": "20 ms", "p95": "48 ms"}
          and split == ["allow=3", "ask=1", "deny=1", "guard_error=0"]
          and chains == ["mcp:jira/wt_echo>mcp:jira/wt_note:2"],
          tiles=tiles, split=split, chains=chains)
    ov = no_overflow(page)
    check("usage-no-horizontal-overflow", ov["docW"] <= ov["winW"] and ov["main"] is not None and ov["main"]["sw"] <= ov["main"]["cw"], **ov)
    page.locator('[data-testid="mcp-usage-tool"][data-subject="mcp:jira/wt_note"] [data-testid="mcp-usage-tool-drill"]').click()
    try:
        page.get_by_test_id("mcp-usage-runs").wait_for(state="visible", timeout=5000)
    except Exception:
        fail("usage-drill-down", page.get_by_test_id("mcp-usage").inner_text())
    runs = page.evaluate("""() => [...document.querySelectorAll('[data-testid="mcp-usage-run"]')].map(r => r.dataset.seat + '@' + r.dataset.run)""")
    check("usage-drill-down", runs == ["codex@r-other", "claude@c1", "codex@c1"]
          and any("subject=mcp%3Ajira%2Fwt_note" in q for q in mcp["usage_queries"]), runs=runs, queries=mcp["usage_queries"])
    page.screenshot(path=str(SHOTS / f"mcp-tools-usage-{STUDIO_SKIN}.png"))
    page.locator('[data-testid="mcp-usage-run"][data-seat="claude"] [data-testid="mcp-usage-run-link"]').click()
    try:
        # /runs/c1 is the legacy address; it redirects to the run's project path, keeping the fragment.
        page.wait_for_function("() => location.pathname.endsWith('/c1') && location.hash === '#governance'", timeout=8000)
    except Exception:
        fail("usage-run-link", page.url)
    gov = page.locator('[data-testid="rail-accordion-governance"]')
    try:
        gov.wait_for(state="visible", timeout=8000)
        expanded = gov.get_attribute("aria-expanded")
    except Exception:
        expanded = None
    check("usage-run-opens-governance", expanded == "true", url=page.url, expanded=expanded)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2, default=str))
