#!/usr/bin/env python3
"""
capture_test.py — Studio OS behaviour 8, "Capture anything", on the actionable pattern
(1440x700, one skin per run).

The drop point sits where you already are: the Capture verb beside Do Work on Home, and the Ask
dock. What the capture run files lands in Home's EXISTING Needs You proposal triage (Wave B,
idea 4), consequence first. Against the `capture` fixture (crew 0.48.0 wire: POST
/projects/:id/capture → {runId}; the run files 1 intent, 2 decisions, 1 memory and 1 development
rule into the `proposals` queue):

  1 verb       Home's verb row carries Capture right after Do Work. Opening it says the consequence
               FIRST (proposals on the chosen project, landing in Needs You, nothing kept until you
               accept). An empty capture says so and sends nothing.
  2 drop       notes + a transcript file + a whiteboard PNG go to POST /projects/upload-endpoint/capture:
               the notes verbatim, the transcript as text, the photo as real PNG bytes; the page
               launches nothing itself. The popover closes; the status line stays.
  3 triage     the 5 filed rows appear in Home's proposal group with the other queue rows: the group
               line and "Accept 5 memory-only" count them, the expanded list leads with the captured
               rule ("Changes enforcement … from your capture") and names each captured class. The
               status line says "5 proposals from your capture waiting in Needs You: 4 memory-only,
               1 changes enforcement".
  4 decide     accept the memory-only ones through the triage's own move (preview → confirm → the
               undo window) → exactly those POST approve; the status line drops to the rule.
  5 ask        the Ask dock carries the same drop, inline, with its consequence; opening it posts
               nothing.

On the Desk (the one shell since S18d) the drop point sits under the Desk's composer, beside its
"Type / for workflows" hint (S19b retired the Start row — the Desk has no verb row), the triage is the Desk's list,
and the Ask dock opens with ⌘/Ctrl+Shift+A (the Desk's composer stands in for Home's Ask invite).

Captures (e2e/shots/): capture-desk-drop.png, capture-desk-triage.png, capture-desk-ask.png.
Env: FEEDBACK_PORT (default 4383). JSON report; exit 0/1.
"""

import json
import os
import sys
import time
import urllib.request

from uxfix_fixture import (DEFAULT_APPEARANCE, HIDE_GATE_TOASTS, REPO, ensure_build,
                           set_fixture, start_server)

PORT = int(os.environ.get("FEEDBACK_PORT", "4383"))
W, H = 1440, 700
SHOTS = REPO / "e2e" / "shots"
PROJECT = "upload-endpoint"
# A real 1x1 PNG — the "whiteboard photo".
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c63f8cfc0f00f0004850180848a6c"
    "210000000049454e44ae426082")
NOTES = "Standup 26 Sep: we chose presigned S3 URLs; next up is resumable uploads."
TRANSCRIPT = "Maya: cap uploads at 5 GB for launch.\nLee: agreed."
GROUP = '[data-testid="need-row"][data-key="group:proposal"]'
MEMBERS = '[data-testid="need-members"][data-group="group:proposal"] [data-testid="need-member"]'

report: dict = {"ok": False, "steps": {}}


class SectionFailed(Exception):
    pass


def fail(step: str, why: str) -> None:
    report["steps"][step] = {"ok": False, "error": why}
    print(json.dumps(report, indent=2))
    sys.exit(1)


def check(step: str, ok: bool, **detail) -> None:
    report["steps"][step] = {"ok": bool(ok), **detail}
    if not ok:
        raise SectionFailed(step)


def get_json(origin: str, path: str):
    with urllib.request.urlopen(f"{origin}{path}", timeout=10) as res:
        return json.loads(res.read())


def captures(origin: str) -> list:
    return [p for p in get_json(origin, "/__fixture/capture-posts")["posts"] if p["route"] == "capture"]


def approves(origin: str) -> list:
    return get_json(origin, "/__fixture/approve-posts")["posts"]


dist = ensure_build(fail)
origin = start_server(PORT, dist)

from playwright.sync_api import sync_playwright  # noqa: E402

SHOTS.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
    page.set_default_timeout(12000)
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    launches: list = []
    page.on("request", lambda r: launches.append(r.url)
            if r.method == "POST" and r.url.endswith("/api/v1/runs") else None)

    set_fixture(origin, capture=True, reset_capture=True, reset_repairs=True, proposals=[],
                appearance={**DEFAULT_APPEARANCE})

    def section_verb() -> None:
        page.goto(f"{origin}/", wait_until="networkidle")
        # The Desk has no verb row (and, since S19b, no Start row): Capture sits under the composer,
        # beside the "Type / for workflows" hint.
        place = page.evaluate("""() => {
            const cap = document.querySelector('[data-testid="composer"][data-composer="desk"] [data-testid="capture"]');
            const composer = document.querySelector('[data-testid="composer"][data-composer="desk"]');
            const input = document.querySelector('[data-testid="desk-composer-input"]');
            if (!cap || !composer || !input) return null;
            return { order: [...cap.parentElement.children].map(e => e.dataset.testid).filter(Boolean),
                     inComposer: true,
                     below: cap.getBoundingClientRect().top >= input.getBoundingClientRect().bottom - 0.5,
                     startRow: document.querySelectorAll('[data-testid="desk-start-row"]').length };
        }""")
        check("capture-beside-the-hint", place is not None and place["order"] == ["composer-hint", "capture"]
              and place["inComposer"] and place["below"] and place["startRow"] == 0, place=place)
        page.get_by_test_id("capture-open").click()
        drop = page.get_by_test_id("capture-drop")
        drop.wait_for(state="visible")
        # The form opens where the operator can use it: its notes and its send button sit inside
        # the viewport as it opens, before anything scrolls them (codex S15a r1 — on the Desk the
        # Start row is the bottom band, so a popover opening downward fell off the screen).
        in_view = page.evaluate("""() => ['capture-notes', 'capture-send'].map(id => {
            const r = document.querySelector(`[data-testid="${id}"]`).getBoundingClientRect();
            return { id, top: Math.round(r.top), bottom: Math.round(r.bottom),
                     ok: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth }; })""")
        check("capture-form-in-view", all(x["ok"] for x in in_view), in_view=in_view, vh=H)
        page.get_by_test_id("capture-project").select_option(PROJECT)
        first = drop.evaluate("el => el.firstElementChild.dataset.testid")
        consequence = page.get_by_test_id("capture-consequence").inner_text()
        check("consequence-first", first == "capture-consequence"
              and f"proposals on {PROJECT}" in consequence and "Needs You" in consequence
              and "Nothing is kept until you accept it" in consequence, first=first, consequence=consequence)
        check("send-names-the-project", page.get_by_test_id("capture-send").inner_text() == f"Capture to {PROJECT}")
        page.get_by_test_id("capture-send").click()
        page.get_by_test_id("capture-error").wait_for(state="visible")
        check("empty-capture-says-so", "notes or a file" in (page.get_by_test_id("capture-error").text_content() or ""))
        check("empty-capture-sends-nothing", captures(origin) == [])

    def section_drop() -> None:
        page.get_by_test_id("capture-notes").fill(NOTES)
        page.get_by_test_id("capture-files").set_input_files([
            {"name": "standup-transcript.txt", "mimeType": "text/plain", "buffer": TRANSCRIPT.encode()},
            {"name": "whiteboard.png", "mimeType": "image/png", "buffer": PNG},
        ])
        kinds = page.locator('[data-testid="capture-file"]').evaluate_all("els => els.map(e => e.dataset.kind)")
        check("files-attached-as-text-and-photo", kinds == ["text", "image"], kinds=kinds)
        page.screenshot(path=str(SHOTS / f"capture-desk-drop.png"))
        page.get_by_test_id("capture-send").click()
        page.get_by_test_id("capture-status").wait_for(state="visible")
        sent = captures(origin)
        check("one-capture-post", len(sent) == 1, sent=sent)
        body = sent[0]
        check("filed-to-the-project", body["projectId"] == PROJECT, projectId=body["projectId"])
        check("notes-verbatim", body["notes"] == NOTES)
        check("transcript-as-text", body["files"][0] == {"name": "standup-transcript.txt", "kind": "text", "text": TRANSCRIPT},
              file=body["files"][0])
        photo = body["files"][1]
        check("photo-as-png-bytes", photo["kind"] == "image" and photo["mediaType"] == "image/png"
              and photo["bytes"] == len(PNG) and photo["png"] is True, photo=photo)
        check("popover-closed", page.get_by_test_id("capture-drop").count() == 0)
        check("nothing-launched-by-the-page", launches == [], launches=launches)

    def section_triage() -> None:
        page.wait_for_selector(GROUP, timeout=15000)
        row = page.locator(GROUP)
        page.wait_for_function(
            f"""() => document.querySelector('{GROUP}')?.getAttribute('data-count') === '5'""", timeout=15000)
        line = row.get_by_test_id("need-line").inner_text()
        check("group-consequence-first", line == "4 memory-only · 1 changes enforcement", line=line)
        act = row.get_by_test_id("need-accept-act")
        check("group-accept-label", act.inner_text().strip() == "Accept 4 memory-only ›", label=act.inner_text())
        page.wait_for_function(
            """() => document.querySelector('[data-testid="capture-status"]')?.dataset.waiting === '5'""", timeout=15000)
        chip = page.get_by_test_id("capture-status-line")
        status = chip.get_attribute("title") or ""
        check("status-says-where-they-wait",
              chip.inner_text() == "· 5 waiting"
              and status.startswith("5 proposals from your capture waiting in Needs You: 4 memory-only, 1 changes enforcement"),
              chip=chip.inner_text(), status=status)
        # The hint and Capture differ in height: one row = one shared band.
        header_rows = page.evaluate("""() => { const rs = [...document.querySelector('[data-testid="composer"][data-composer="desk"] [data-testid="capture"]').parentElement.children]
            .map(c => c.getBoundingClientRect()).filter(r => r.height > 0);
            return Math.max(...rs.map(r => r.top)) < Math.min(...rs.map(r => r.bottom)) ? 1 : 2; }""")
        check("verb-row-stays-one-row", header_rows == 1, rows=header_rows)
        row.get_by_test_id("need-group-toggle").click()
        members = page.locator(MEMBERS)
        lines = [members.nth(i).get_by_test_id("need-line").inner_text() for i in range(members.count())]
        check("rule-leads-with-its-consequence",
              lines[0] == "Changes enforcement — lands a development rule (warn) from your capture", lines=lines)
        check("captured-classes-named",
              any("a captured intent" in l for l in lines) and any("a captured decision" in l for l in lines),
              lines=lines)
        page.screenshot(path=str(SHOTS / f"capture-desk-triage.png"))

    def section_decide() -> None:
        row = page.locator(GROUP)
        row.get_by_test_id("need-accept-act").click()
        page.get_by_test_id("need-accept-preview").wait_for(state="visible")
        check("preview-posts-nothing", approves(origin) == [])
        page.get_by_test_id("need-accept-confirm").click()
        page.get_by_test_id("undo-toast").wait_for(state="visible")
        page.wait_for_function("""() => !document.querySelector('[data-testid="need-accept-act"]')""", timeout=25000)
        run_id = captures(origin)[0]["runId"]
        want = sorted(f"{run_id}-p{i}" for i in (1, 2, 3, 4))
        check("accepts-exactly-the-captured-memories", sorted(approves(origin)) == want, posts=approves(origin))
        page.wait_for_function(
            """() => document.querySelector('[data-testid="capture-status"]')?.dataset.waiting === '1'""", timeout=15000)
        status = page.get_by_test_id("capture-status-line").get_attribute("title") or ""
        check("status-follows-the-triage",
              status.startswith("1 proposal from your capture waiting in Needs You: 1 changes enforcement"), status=status)

    def section_ask() -> None:
        page.keyboard.press("Control+Shift+A")  # the Desk's composer stands in for Home's Ask invite
        dock_capture = page.locator('[data-testid="assist-thread"] [data-testid="capture-open"]')
        dock_capture.wait_for(state="visible")
        dock_capture.click()
        drop = page.locator('[data-testid="assist-thread"] [data-testid="capture-drop"]')
        drop.wait_for(state="visible")
        check("ask-dock-drop-inline", drop.get_attribute("role") is None)
        check("ask-dock-consequence", "Nothing is kept until you accept it" in drop.get_by_test_id("capture-consequence").inner_text())
        check("ask-dock-posts-nothing", len(captures(origin)) == 1)
        line = page.locator('[data-testid="assist-thread"] [data-testid="capture-status-line"]').inner_text()
        check("ask-dock-full-status", line.startswith("1 proposal from your capture waiting in Needs You"), line=line)
        page.screenshot(path=str(SHOTS / f"capture-desk-ask.png"))

    ok = True
    for section in (section_verb, section_drop, section_triage, section_decide, section_ask):
        try:
            section()
        except SectionFailed:
            ok = False
            break
        except Exception as e:  # noqa: BLE001 — a journey reports, never tracebacks
            report["steps"][section.__name__] = {"ok": False, "error": repr(e)[:400]}
            page.screenshot(path=str(SHOTS / f"capture-desk-fail.png"))
            ok = False
            break
    browser.close()

report["ok"] = ok
print(json.dumps(report, indent=2))
sys.exit(0 if ok else 1)
