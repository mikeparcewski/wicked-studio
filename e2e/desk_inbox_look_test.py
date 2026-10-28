"""The Desk's inbox, designed (operator 2026-10-16: "On the desk, the inbox just looks like a thing of
boxes in both light/dark modes - needs more design").

The operator's path: open Needs you in full (home v2: the landing's "N more waiting"), read it, switch to
Failures, pick an item. In each of the
four themes (wicked-light, wicked-dark, light, dark) at 1440x700, it certifies the inbox reads as one
designed list, not boxes in boxes:

  1. the folders are one segmented control: the selected folder is a raised pill, each count a badge;
  2. every item has a round kind mark (an icon; decision / failure each in its own tone), the unread
     ones a dot on it; items have no border box of their own and are divided by hairlines;
  (the inbox itself is defined from the page: an outline, or since 2026-10-26 a raised shadow a step
     above a plain card's);
  3. section labels carry their counts ("Decisions · 2");
  4. an item's moves are quiet (no border) at the end of its job line;
  5. the reading pane is a raised panel (its own surface, no side rule) with a kind tag ("Decision",
     "Failed") above the headline;
  6. the subject and the sender read at >= 4.5:1 on their row in every theme;
  7. the keyboard's ring shows on the selected folder (its pill shadow never hides it);
  8. with a group of approvals (the wave corpus), the group's batch moves take their own line and its
     snippet keeps its width;
and on a 390px phone the moves keep their own tap-sized line under the item, the folders are tap-sized,
with no sideways scroll.

Captures: e2e/shots/desk-inbox-look-*.png. Env: FEEDBACK_PORT (default 4603).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, set_fixture, start_server

# Home v2 (2026-10-26): the landing shows one card; "N more waiting" opens Needs you in full (the Desk's
# `/needs`), the inbox this journey designs.
INBOX = "/needs"

PORT = int(os.environ.get("FEEDBACK_PORT", "4603"))
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

LOOK = r"""() => {
  const q = (s, r = document) => r.querySelector(s); const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const rgb = (c) => { const m = c.match(/[\d.]+/g) || []; return m.slice(0, 4).map(Number); };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  // The colour an element is drawn on: the first ancestor with an opaque background.
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.9)) return c; } return [255, 255, 255]; };
  const contrast = (el) => { const a = lum(rgb(getComputedStyle(el).color)), b = lum(bgOf(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  const inbox = q('[data-testid="desk-inbox"]');
  const folders = q('.wk-inbox-folders', inbox);
  const sel = q('.wk-inbox-folder[aria-selected="true"]', inbox);
  const rows = qa('[data-testid="need-row"]', inbox);
  const pane = q('[data-testid="desk-inbox-pane"]', inbox);
  return {
    folders: { bg: getComputedStyle(folders).backgroundColor, radius: parseFloat(getComputedStyle(folders).borderTopLeftRadius),
      selBg: getComputedStyle(sel).backgroundColor, badges: qa('.wk-inbox-folder-n', inbox).length, tabs: qa('.wk-inbox-folder', inbox).length },
    rows: rows.map((r) => { const cs = getComputedStyle(r); const mark = q('.wk-inbox-mark', r); const ms = getComputedStyle(mark);
      return { section: r.dataset.section, unread: r.dataset.unread === 'true', border: parseFloat(cs.borderTopWidth) + parseFloat(cs.borderLeftWidth), markIcon: !!q('svg', mark),
        markRound: parseFloat(ms.borderTopLeftRadius) >= 12, markW: Math.round(mark.getBoundingClientRect().width), markColor: ms.color, markBg: ms.backgroundColor,
        dot: getComputedStyle(mark, '::after').content !== 'none', hairline: getComputedStyle(r, '::after').content !== 'none',
        acts: qa('.wk-inbox-acts .wk-need-act', r).map((a) => { const c = getComputedStyle(a); const quiet = a.classList.contains('wk-need-act--quiet');
          const outlined = parseFloat(c.borderTopWidth) > 0 && c.borderTopColor !== 'rgba(0, 0, 0, 0)'; return quiet ? !outlined : outlined; }),
        chip: q('[data-testid="need-kind"]', r)?.innerText ?? null,
        subj: contrast(q('[data-testid="need-line"]', r)), sender: contrast(q('.wk-inbox-sender', r)) }; }),
    sections: qa('[data-testid="need-section"]', inbox).map((s) => s.innerText),
    identity: { icon: !!q('.wk-inbox-icon svg', inbox), subtitle: q('[data-testid="desk-inbox-subtitle"]', inbox)?.innerText ?? null,
      border: parseFloat(getComputedStyle(inbox).borderTopWidth), count: q('[data-testid="desk-inbox-count"]', inbox)?.innerText ?? null,
      // Defined by elevation (2026-10-26): the lead card's shadow is a step above a plain card's (Happening now).
      shadow: getComputedStyle(inbox).boxShadow, cardShadow: q('[data-testid="desk-happening"]') === null ? null : getComputedStyle(q('[data-testid="desk-happening"]')).boxShadow },
    pane: pane === null ? null : { bg: getComputedStyle(pane).backgroundColor, card: getComputedStyle(inbox).backgroundColor,
      ruleLeft: parseFloat(getComputedStyle(pane).borderLeftWidth), kind: q('[data-testid="desk-inbox-kind"]', pane)?.innerText ?? null },
    hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  };
}"""


def look_ok(tag: str, m: dict, kind: str) -> None:
    check(f"{tag}-folders-segmented", m["folders"]["radius"] >= 12 and m["folders"]["selBg"] != m["folders"]["bg"]
          and m["folders"]["badges"] == m["folders"]["tabs"], folders=m["folders"])
    rows = m["rows"]
    check(f"{tag}-items-are-a-list", len(rows) > 0 and all(r["border"] == 0 and r["markIcon"] and r["markRound"] and r["markW"] == 28 for r in rows)
          and all(r["dot"] == r["unread"] for r in rows), rows=rows)
    by = {r["section"]: r for r in rows}
    if "decision" in by and "failure" in by:
        check(f"{tag}-kinds-have-tones", by["decision"]["markColor"] != by["failure"]["markColor"], decision=by["decision"], failure=by["failure"])
    check(f"{tag}-sections-counted", all(" · " in s for s in m["sections"]), sections=m["sections"])
    check(f"{tag}-moves-are-buttons", all(all(r["acts"]) for r in rows), rows=[r["acts"] for r in rows])
    check(f"{tag}-each-item-says-its-kind", all((r["chip"] or "").strip() != "" for r in rows), chips=[r["chip"] for r in rows])
    i = m["identity"]
    check(f"{tag}-reads-as-the-inbox", i["icon"] and "waiting on you" in (i["subtitle"] or "") and (i["border"] >= 1 or (i["shadow"] not in (None, "", "none") and i["shadow"] != i["cardShadow"])) and "waiting" in (i["count"] or ""), identity=i)
    p = m["pane"]
    check(f"{tag}-pane-raised-with-kind", p is not None and p["bg"] != p["card"] and p["ruleLeft"] == 0 and p["kind"] == kind, pane=p)
    check(f"{tag}-readable", all(r["subj"] >= 4.5 and r["sender"] >= 4.5 for r in rows), contrast=[(r["subj"], r["sender"]) for r in rows])


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1440, "height": 700}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.add_init_script(
        "document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); "
        f"s.textContent = {json.dumps(HIDE_GATE_TOASTS)}; document.head.appendChild(s); }});")
    page.goto(f"{origin}{INBOX}", wait_until="networkidle")
    page.locator('[data-testid="desk-inbox-count"]').wait_for(state="visible", timeout=15000)
    page.wait_for_selector('[data-testid="desk-inbox-read"]', timeout=10000)
    page.wait_for_timeout(300)
    for theme in ("wicked-light", "wicked-dark", "light", "dark"):
        page.evaluate("(t) => t === 'dark' ? document.documentElement.removeAttribute('data-theme') : document.documentElement.setAttribute('data-theme', t)", theme)
        page.get_by_test_id("desk-inbox-folder-all").click()
        page.wait_for_timeout(250)
        # The pane keeps the item last read (any folder): read the first decision again.
        page.locator('[data-testid="need-row"][data-section="decision"] [data-testid="desk-inbox-row"]').first.click()
        page.wait_for_timeout(250)
        m = page.evaluate(LOOK)
        page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / f"desk-inbox-look-all-{theme}.png"))
        look_ok(f"{theme}-all", m, "Decision")
        page.get_by_test_id("desk-inbox-folder-failure").click()
        page.wait_for_timeout(250)
        page.get_by_test_id("desk-inbox-row").first.click()
        page.wait_for_timeout(250)
        m = page.evaluate(LOOK)
        page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / f"desk-inbox-look-failures-{theme}.png"))
        look_ok(f"{theme}-failures", m, "Failed")
    # 6b. Empty, it is still the inbox: its mark, name and an explicit "Nothing needs you right now".
    set_fixture(origin, no_runs=True, roster_signed_in={"codex": True})
    page.goto(f"{origin}{INBOX}", wait_until="networkidle")
    page.get_by_test_id("home-calm").wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(400)
    empty = page.evaluate("""() => ({ calm: document.querySelector('[data-testid="home-calm"]')?.innerText ?? '',
      icon: !!document.querySelector('[data-testid="desk-inbox"] .wk-inbox-icon svg'), rows: document.querySelectorAll('[data-testid="need-row"]').length })""")
    for theme in ("wicked-light", "wicked-dark"):
        page.evaluate("(t) => document.documentElement.setAttribute('data-theme', t)", theme)
        page.wait_for_timeout(150)
        page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / f"desk-inbox-look-empty-{theme}.png"))
    check("empty-is-still-the-inbox", empty["rows"] == 0 and "Nothing needs you right now" in empty["calm"] and empty["icon"], empty=empty)
    set_fixture(origin, no_runs=False, roster_signed_in={})
    page.goto(f"{origin}{INBOX}", wait_until="networkidle")
    page.locator('[data-testid="desk-inbox-count"]').wait_for(state="visible", timeout=15000)

    # 7. The keyboard's ring on the selected folder.
    page.get_by_test_id("desk-inbox-folder-all").click()
    page.get_by_test_id("desk-inbox-folder-all").focus()
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowLeft")
    ring = page.evaluate("() => { const a = document.activeElement; return { id: a?.dataset?.testid, visible: a?.matches(':focus-visible'), shadow: getComputedStyle(a).boxShadow }; }")
    page.mouse.click(5, 5)
    shadow_rest = page.evaluate("() => getComputedStyle(document.querySelector('.wk-inbox-folder[aria-selected=\"true\"]')).boxShadow")
    check("selected-folder-keeps-focus-ring", ring["visible"] and ring["shadow"] != shadow_rest, ring=ring, rest=shadow_rest)

    # 8. A group of approvals: its moves on their own line; its snippet keeps its width.
    set_fixture(origin, wave1=True, wave2b=True, simple_gates=["g1", "g2"], gate_now=[], status_over={}, extra_frames=[])
    page.goto(f"{origin}{INBOX}", wait_until="networkidle")
    page.locator('[data-testid="desk-inbox-count"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(500)
    groups = page.evaluate("""() => [...document.querySelectorAll('[data-testid="need-row"]:not([data-count="1"])')].map((r) => {
      const s = r.querySelector('.wk-inbox-snippet').getBoundingClientRect(); const a = r.querySelector('.wk-inbox-acts').getBoundingClientRect();
      return { count: r.dataset.count, snippetW: Math.round(s.width), actsBelow: a.top >= s.bottom - 1 }; })""")
    page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / "desk-inbox-look-groups.png"))
    check("group-moves-own-line", len(groups) >= 1 and all(g["snippetW"] >= 60 and g["actsBelow"] for g in groups), groups=groups)
    set_fixture(origin, wave1=False, wave2b=False, simple_gates=[], gate_now=[], status_over={}, extra_frames=[])
    ctx.close()

    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}{INBOX}", wait_until="networkidle")
    page.locator('[data-testid="desk-inbox-count"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(300)
    phone = page.evaluate("""() => { const r = document.querySelector('[data-testid="need-row"]'); const a = r.querySelector('.wk-inbox-acts');
      const s = r.querySelector('.wk-inbox-snippet'); const act = a.querySelector('.wk-need-act');
      return { below: a.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 1, tap: act ? act.getBoundingClientRect().height : null,
               pane: getComputedStyle(document.querySelector('.wk-inbox-pane') ?? document.body).display,
               folders: Math.min(...[...document.querySelectorAll('.wk-inbox-folder')].map((f) => f.getBoundingClientRect().height)),
               hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; }""")
    page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / "desk-inbox-look-phone.png"))
    check("phone-moves-own-line", phone["below"] and phone["tap"] is not None and phone["tap"] >= 44 and phone["pane"] == "none" and phone["folders"] >= 44 and not phone["hscroll"], phone=phone)

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
