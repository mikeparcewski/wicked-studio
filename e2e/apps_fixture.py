"""
apps_fixture.py — the in-process fixture's stand-in for crew's app store and app data routes (DES-APPS-001 §6.4,
§7.2, §7.3, §7.6; studio slice K4), used by e2e/apps_runtime_test.py through uxfix_fixture's `apps` switch.

  - The store mirrors crew main's rules (packages/crew/src/apps/store.ts, K2a): every edit, undo and redo names its
    base (`409 stale_base` with `head`); versions carry receipts (`you`, `restored`); undo/redo move ONE accepted-history
    pointer kept here, so every tab agrees; a new edit drops the redo side.
  - The data routes answer the shapes K2b will serve: `POST …/query {version, query, params}` (api-types
    `AppQueryResponse`), `POST …/actions/:id/prepare {version, params}` → `{record, card, expiresAt}` and
    `POST …/actions/:id/run {record}` → `{state, reason}`. A row write applies to the fixture's rows.
  - Every request is recorded (GET /__fixture/apps-calls), so a journey can count edits, prepares and runs.
    POST /__fixture/apps-reset puts both apps back; POST /__fixture/apps-caps {query, actions} flips the health flags.

Hostile values (S4/S12) live in the rows and the text on purpose: the runtime must show them as text.
"""

import copy
import hashlib
import json
import threading
import time

lock = threading.Lock()
VIEWER = "priya@example.com"

SPEC_A = {
    "schema": "wicked.apps/v1", "name": "Fixture desk", "linkHosts": ["docs.example.com"],
    "description": "<img src=x onerror=window.__pwned=4> a desk for the journey",
    "pages": [{"id": "main", "title": "Main", "components": [
        {"id": "search", "type": "filter", "filter": "search", "label": "Search", "box": {"x": 0, "y": 0, "w": 4, "h": 1}},
        {"id": "open_kpi", "type": "kpi", "title": "Open", "box": {"x": 0, "y": 1, "w": 3, "h": 2}, "data": {"query": "open_count"}, "value": "open"},
        {"id": "by_region", "type": "chart", "chart": "bar", "title": "By region", "box": {"x": 3, "y": 1, "w": 5, "h": 4},
         "data": {"query": "by_region"}, "x": "region", "series": [{"column": "n"}]},
        {"id": "note", "type": "text", "text": "<b>bold?</b> <img src=x onerror=window.__pwned=1>", "box": {"x": 8, "y": 1, "w": 4, "h": 2}},
        {"id": "docs", "type": "link", "label": "Docs", "to": {"kind": "href", "href": "https://docs.example.com/guide"}, "box": {"x": 8, "y": 3, "w": 2, "h": 1}},
        {"id": "evil", "type": "link", "label": "Elsewhere", "to": {"kind": "href", "href": "https://evil.example.net/x"}, "box": {"x": 10, "y": 3, "w": 2, "h": 1}},
        {"id": "jsurl", "type": "link", "label": "Script", "to": {"kind": "href", "href": "javascript:window.__pwned=2"}, "box": {"x": 8, "y": 4, "w": 2, "h": 1}},
        {"id": "ping", "type": "button", "box": {"x": 10, "y": 4, "w": 2, "h": 1}, "action": {"label": "Ping", "action": "ping_api"}},
        {"id": "tickets", "type": "table", "title": "Tickets", "box": {"x": 0, "y": 5, "w": 12, "h": 5},
         "data": {"query": "tickets", "params": {"search": "filter.search"}},
         "rowActions": [{"label": "Assign to me", "action": "assign_to_me", "params": {"id": "row.id"}}]},
    ]}],
    "queries": [
        {"id": "open_count", "source": "support-pg", "kind": "sql", "output": [{"name": "open", "type": "integer"}]},
        {"id": "by_region", "source": "support-pg", "kind": "sql", "output": [{"name": "region", "type": "string"}, {"name": "n", "type": "integer"}]},
        {"id": "tickets", "source": "support-pg", "kind": "sql", "params": {"type": "object", "properties": {"search": {"type": "string"}}},
         "output": [{"name": "id", "type": "integer"}, {"name": "subject", "type": "string"}, {"name": "owner", "type": "string"}]},
    ],
    "actions": [
        {"id": "assign_to_me", "kind": "row-write", "source": "support-pg-writer", "table": "support.tickets", "op": "update",
         "set": {"owner": {"kind": "viewer", "claim": "email"}}, "key": {"id": {"kind": "param", "name": "id"}},
         "params": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]}},
        {"id": "ping_api", "kind": "api", "source": "ops-api", "call": {"kind": "tool", "tool": "POST /ping"},
         "args": {"note": {"kind": "literal", "value": "from the app"}}},
    ],
}

HOSTILE = ["<img src=x onerror=window.__pwned=1>", "javascript:alert(1)", "<script>window.__pwned=3</script>"]
ROWS_A = {
    "open_count": [[4]],
    "by_region": [["EMEA", 3], ["APAC", 1]],
    "tickets": [[4821, HOSTILE[0], "unassigned"], [4822, HOSTILE[1], "unassigned"], [4823, HOSTILE[2], "m.chen"], [4824, "Printer on fire", "unassigned"]],
}

# App B: a query app A's frame must never reach (S7).
SPEC_B = {
    "schema": "wicked.apps/v1", "name": "<script>window.__pwned=5</script> Other app", "linkHosts": [],
    "pages": [{"id": "p", "title": "P", "components": [
        {"id": "t", "type": "table", "box": {"x": 0, "y": 0, "w": 12, "h": 4}, "data": {"query": "b_secret"}}]}],
    "queries": [{"id": "b_secret", "source": "hr-db", "kind": "sql", "output": [{"name": "salary", "type": "integer"}]}],
    "actions": [],
}
ROWS_B = {"b_secret": [[123456]]}

# How long a prepared record lives (crew: 2 minutes); POST /__fixture/apps-caps {recordMs} shortens it for a journey.
RECORD_MS = 120_000
APPS: dict = {}
CALLS: list = []
RECORDS: dict = {}
CAPS = {"query": True, "actions": True, "turns": False, "publish": False, "uploads": False, "sourceCheck": True}


def _tree(spec) -> str:
    return hashlib.sha1(json.dumps(spec, sort_keys=True).encode()).hexdigest()


def _now() -> int:
    return int(time.time() * 1000)


def _make(slug: str, spec: dict, rows: dict) -> dict:
    tree = _tree(spec)
    receipt = {"kind": "reviewed", "tree": tree, "version": 1, "at": _now(), "actor": {"id": "local", "kind": "human", "trust": "operator"},
               "review": {"runId": "r-fixture", "builder": "claude", "reviewer": "codex"}}
    return {"slug": slug, "specs": {1: copy.deepcopy(spec)}, "rows": copy.deepcopy(rows), "versions": [
        {"version": 1, "commit": tree, "tree": tree, "base": None, "at": _now(), "author": {"kind": "seat", "id": "claude"},
         "receipt": receipt, "summary": "The first turn", "check": {"level": "full", "checked": []}}],
        "history": {"states": [1], "pointer": 0}}


def reset() -> None:
    with lock:
        APPS.clear()
        APPS["fixture-app"] = _make("fixture-app", SPEC_A, ROWS_A)
        APPS["other-app"] = _make("other-app", SPEC_B, ROWS_B)
        CALLS.clear()
        RECORDS.clear()
        CAPS.update({"query": True, "actions": True})
        global RECORD_MS
        RECORD_MS = 120_000


reset()


# The published record K6 will write (studio reads it from GET /apps/:app `published`; the proposed shape is in the
# ledger): only fixture-app is published, so a journey sees both Share states.
# K6's proposed `AppDetail.published` (ledger 2026-11-03T18:26Z), the fields the Share sheet reads plus a few it ignores.
PUBLISHED = {"fixture-app": {"shareUrl": "https://fixture-desk.apps.example.test/", "audience": "signed-in members of support-ops",
                             # K6's producer's shape (crew apps/publish/service.ts): the name entity-escaped, style border:0.
                             "snippet": '<iframe src="https://fixture-desk.apps.example.test/" title="Fixture desk &#38; co" width="100%" height="600" style="border:0" loading="lazy" referrerpolicy="no-referrer"></iframe>',
                             "version": 1, "at": 1762160400000, "targets": ["site", "embed"], "tree": "t", "runId": "r"}}


def capabilities() -> dict:
    with lock:
        return dict(CAPS)


def _detail(a: dict) -> dict:
    head = a["versions"][-1]
    states, pointer = a["history"]["states"], a["history"]["pointer"]
    spec = a["specs"][head["version"]]
    extra = {"published": PUBLISHED[a["slug"]]} if a["slug"] in PUBLISHED else {}
    return {**extra, "slug": a["slug"], "name": spec["name"], "projectId": "notes", "repoId": a["slug"], "createdAt": a["versions"][0]["at"],
            "head": {"version": head["version"], "tree": head["tree"], "receipt": head["receipt"]["kind"] if head["receipt"] else None},
            "turn": None, "spec": copy.deepcopy(spec),
            "lock": {"schema": "wicked.apps.lock/v1", "sources": {}, "queries": {}, "actions": {}, "uploads": {}},
            "queryText": {}, "versions": copy.deepcopy(a["versions"]),
            "history": {"states": list(states), "pointer": pointer, "canUndo": pointer > 0, "canRedo": 0 <= pointer < len(states) - 1}}


def _land(a: dict, spec: dict, summary: str, receipt: dict, author: dict) -> dict:
    head = a["versions"][-1]["version"]
    v = head + 1
    tree = _tree(spec)
    receipt = {**receipt, "tree": tree, "version": v, "at": _now(), "actor": {"id": "local", "kind": "human", "trust": "operator"}}
    landed = {"version": v, "commit": tree, "tree": tree, "base": head, "at": _now(), "author": author, "receipt": receipt,
              "summary": summary[:200], "check": {"level": "spec", "checked": []}}
    a["versions"].append(landed)
    a["specs"][v] = copy.deepcopy(spec)
    return landed


def _refuse(status: int, code: str, error: str, **extra) -> tuple:
    return status, {"code": code, "error": error, **extra}


def _stale(a: dict, base, what: str):
    head = a["versions"][-1]["version"]
    if base != head:
        return _refuse(409, "stale_base", f"{what} was made on v{base}, but {a['slug']} is at v{head}; reload and try again", head=head)
    return None


def _text(v) -> str:
    return "null" if v is None else v if isinstance(v, str) else json.dumps(v)


def _unbound(schema) -> list:
    """Required parameters nothing fills (crew's `unbound_param` rule, packages/crew/src/apps/spec.ts)."""
    props = (schema or {}).get("properties", {})
    return [r for r in (schema or {}).get("required", []) if r in props and "from" not in props[r] and "default" not in props[r]]


def _check(spec: dict) -> list:
    """The part of crew's spec check a studio edit can break: every binding names a query or action of this spec,
    and every required parameter nobody else fills is bound where it is used."""
    findings = []
    queries = {q["id"]: q for q in spec.get("queries", [])}
    actions = {a["id"]: a for a in spec.get("actions", [])}
    for pi, page in enumerate(spec.get("pages", [])):
        for ci, c in enumerate(page.get("components", [])):
            at = f"$.pages[{pi}].components[{ci}]"
            sites = []
            if "data" in c:
                sites.append((queries.get(c["data"]["query"]), c["data"].get("params") or {}, f"{at}.data", c["data"]["query"]))
            opts = c.get("options") if c["type"] == "filter" else None
            if isinstance(opts, dict) and opts.get("kind") == "query":
                sites.append((queries.get(opts["query"]["query"]), opts["query"].get("params") or {}, f"{at}.options.query", opts["query"]["query"]))
            for b, where in ([(c["action"], "action")] if c["type"] == "button" else []) + ([(c["submit"], "submit")] if c["type"] == "form" else []) \
                    + [(r, f"rowActions[{i}]") for i, r in enumerate(c.get("rowActions") or [])]:
                sites.append((actions.get(b["action"]), b.get("params") or {}, f"{at}.{where}", b["action"]))
            for target, bound, path, name in sites:
                if target is None:
                    findings.append({"stage": "spec", "code": "unknown_ref", "path": path, "message": f"{name} is not declared"})
                    continue
                for r in _unbound(target.get("params")):
                    if r not in bound:
                        findings.append({"stage": "spec", "code": "unbound_param", "path": f"{path}.params", "message": f"required parameter {json.dumps(r)} has no binding, default or viewer claim"})
    return findings


def handle(method: str, path: str, body):
    """Answer an /api/v1/apps or /__fixture/apps* request: (status, json) or None when it is not one of these. Every
    /api/v1/apps call is recorded with the status it got."""
    if path == "/api/v1/apps" and method == "GET":
        with lock:
            CALLS.append({"method": method, "path": path, "body": None, "at": _now(), "status": 200})
            out = []
            for a in APPS.values():
                d = _detail(a)
                out.append({k: d[k] for k in ("slug", "name", "projectId", "repoId", "createdAt", "head", "turn")})
            return 200, {"apps": out}
    if not path.startswith("/api/v1/apps/"):
        return _answer(method, path, body)
    with lock:
        call = {"method": method, "path": path, "body": copy.deepcopy(body), "at": _now()}
        r = _answer(method, path, body, locked=True)
        call["status"] = r[0] if r else None
        CALLS.append(call)
    return r


def _answer(method: str, path: str, body, locked: bool = False):
    if path == "/__fixture/apps-calls" and method == "GET":
        with lock:
            return 200, {"calls": copy.deepcopy(CALLS)}
    if path == "/__fixture/apps-reset" and method == "POST":
        reset()
        return 200, {"ok": True}
    if path == "/__fixture/apps-caps" and method == "POST":
        global RECORD_MS
        with lock:
            for k in ("query", "actions"):
                if isinstance((body or {}).get(k), bool):
                    CAPS[k] = body[k]
            if isinstance((body or {}).get("recordMs"), int):
                RECORD_MS = body["recordMs"]
        return 200, {"caps": capabilities()}
    if not path.startswith("/api/v1/apps/"):
        return None
    parts = path[len("/api/v1/apps/"):].split("/")
    slug = parts[0]
    rest = parts[1:]
    if locked:  # handle() holds the lock for every /api/v1/apps call
        a = APPS.get(slug)
        if a is None:
            return _refuse(404, "unknown_app", f"no app {slug}")
        if method == "GET" and rest == []:
            return 200, {"app": _detail(a)}
        if method != "POST":
            return _refuse(404, "bad_request", "no such route")
        body = body or {}
        if rest == ["edits"]:
            stale = _stale(a, body.get("base"), "this edit")
            if stale:
                return stale
            ops = body.get("ops") or []
            spec = next((o["spec"] for o in ops if o.get("op") == "spec"), None)
            if spec is None:
                return _refuse(400, "bad_request", "an edit holds a spec op")
            findings = _check(spec)
            if findings:
                return _refuse(422, "check_failed", "; ".join(f["message"] for f in findings[:5]), findings=findings)
            landed = _land(a, spec, body.get("summary") or "An edit", {"kind": "you"}, {"kind": "human", "id": "local"})
            h = a["history"]
            h["states"] = h["states"][: h["pointer"] + 1] + [landed["version"]]
            h["pointer"] = len(h["states"]) - 1
            return 200, {"app": _detail(a), "landed": landed}
        if rest in (["undo"], ["redo"]):
            direction = rest[0]
            stale = _stale(a, body.get("base"), f"this {direction}")
            if stale:
                return stale
            h = a["history"]
            to = h["pointer"] - 1 if direction == "undo" else h["pointer"] + 1
            if to < 0 or to >= len(h["states"]):
                return _refuse(409, "nothing_to_undo" if direction == "undo" else "nothing_to_redo", "nothing to move to")
            target = h["states"][to]
            held = a["versions"][target - 1]["receipt"]
            # The restored version's own provenance, followed through any chain of restores (crew's restoredReceipt).
            origin = held.get("restoredFrom") or {"originKind": held["kind"], "originVersion": target}
            landed = _land(a, a["specs"][target], f"{direction.title()} to v{target}",
                           {"kind": "restored", "restoredFrom": {"version": target, "originKind": origin["originKind"], "originVersion": origin["originVersion"]}},
                           {"kind": "human", "id": "local"})
            h["pointer"] = to
            return 200, {"app": _detail(a), "landed": landed}
        if rest == ["query"]:
            version = body.get("version")
            spec = a["specs"].get(version)
            if spec is None:
                return _refuse(404, "unknown_version", f"{slug} has no version {version}")
            q = next((x for x in spec["queries"] if x["id"] == body.get("query")), None)
            if q is None:
                return _refuse(404, "unknown_query", f"this version of {slug} has no query {body.get('query')}")
            rows = a["rows"].get(q["id"], [])
            needle = (body.get("params") or {}).get("search")
            if isinstance(needle, str) and needle.strip():
                rows = [r for r in rows if any(isinstance(c, str) and needle.lower() in c.lower() for c in r)]
            return 200, {"columns": q["output"], "rows": copy.deepcopy(rows), "truncated": False, "hasMore": False, "ms": 3, "cachedAt": None}
        if len(rest) == 3 and rest[0] == "actions" and rest[2] in ("prepare", "run"):
            head = a["versions"][-1]["version"]
            spec = a["specs"][head]
            act = next((x for x in spec["actions"] if x["id"] == rest[1]), None)
            if act is None:
                return _refuse(404, "bad_request", f"no action {rest[1]}")
            if rest[2] == "run":
                # §7.3: run executes the operation the card was drawn from (the record's version), and only while the
                # head still declares that same action: a changed action withdraws the record (crew rechecks hashes).
                rec = RECORDS.get(body.get("record"))
                if rec is not None and rec.get("app") == slug:
                    drawn = next((x for x in a["specs"][rec["version"]]["actions"] if x["id"] == rec["action"]), None)
                    if drawn is None or drawn != act:
                        rec["state"] = "withdrawn"
                        return _refuse(409, "bad_request", "the action changed since its card was drawn; nothing ran")
                    act = drawn
            if rest[2] == "prepare":
                # §7.3: a record is bound to app, version and action, for the version the viewer is looking at.
                if body.get("version") != head:
                    return _refuse(409, "not_accepted", f"prepare named v{body.get('version')}; {slug} is at v{head}")
                params = body.get("params") or {}
                record = f"rec-{len(RECORDS) + 1}"
                RECORDS[record] = {"app": slug, "version": head, "action": act["id"], "params": params, "state": "prepared", "expiresAt": _now() + RECORD_MS}
                if act["kind"] == "row-write":
                    card = {"kind": "row-write", "source": "support-pg-writer (postgres)", "operation": "UPDATE support.tickets",
                            "rows": [{"label": "owner", "value": VIEWER, "from": "your sign-in"}],
                            "key": f"id = {_text(params.get('id'))} (exactly 1 row, verified)",
                            "checks": "Checked just now: a plain table with no triggers, rules, inheritance, row security or cascading keys.",
                            "request": "UPDATE ONLY support.tickets AS w SET owner = $1::text WHERE w.id = $2::int4 RETURNING pg_typeof(w.*), w.id, owner_ok",
                            "says": None}
                else:
                    card = {"kind": "api", "source": "ops-api (rest)", "operation": "POST /ping",
                            "rows": [{"label": "note", "value": "from the app", "from": "fixed by the app"}], "key": None, "checks": None,
                            "request": 'POST https://ops.example.com/ping\n{"note": "from the app"}', "says": "Pings the on-call channel."}
                return 200, {"record": record, "card": card, "expiresAt": RECORDS[record]["expiresAt"]}
            rec = RECORDS.get(body.get("record"))
            if rec is None or rec["app"] != slug or rec["action"] != act["id"] or rec["state"] != "prepared":
                return _refuse(409, "bad_request", "that record is not prepared for this action")
            if _now() >= rec["expiresAt"]:
                rec["state"] = "expired"
                return _refuse(409, "bad_request", "that record expired; nothing ran")
            rec["state"] = "succeeded"
            if act["kind"] == "row-write":
                for r in a["rows"].get("tickets", []):
                    if r[0] == rec["params"].get("id"):
                        r[2] = VIEWER
            return 200, {"state": "succeeded", "reason": None}
        return _refuse(404, "bad_request", "no such route")


def framer_html(src: str) -> str:
    """A same-origin page that frames studio (S8's case the host must refuse even though frame-ancestors 'self' allows it)."""
    safe = src.replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    return ('<!doctype html><html><head><meta charset="utf-8"><title>Framer</title></head>'
            f'<body style="margin:0"><iframe id="studio" src="{safe}" width="1400" height="680"></iframe></body></html>')
