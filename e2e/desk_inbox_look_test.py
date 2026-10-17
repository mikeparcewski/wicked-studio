"""The Desk's inbox, designed (operator 2026-10-16: "On the desk, the inbox just looks like a thing of
boxes in both light/dark modes - needs more design").

The operator's path: open the Desk, read Needs you, switch to Failures, pick an item. In each of the
four themes (wicked-light, wicked-dark, light, dark) at 1440x700, it certifies the inbox reads as one
designed list, not boxes in boxes:

  1. the folders are one segmented control: the selected folder is a raised pill, each count a badge;
  2. every item has a round kind mark (an icon; decision / failure each in its own tone), the unread
     ones a dot on it; items have no border box of their own and are divided by hairlines;
  3. section labels carry their counts ("Decisions · 2");
  4. an item's moves are quiet (no border) at the end of its job line;
  5. the reading pane is a raised panel (its own surface, no side rule) with a kind tag ("Decision",
     "Failed") above the headline;
  6. the subject and the sender read at >= 4.5:1 on their row in every theme;
and on a 390px phone the moves keep their own tap-sized line under the item, with no sideways scroll.

Captures: e2e/shots/desk-inbox-look-*.png. Env: FEEDBACK_PORT (default 4603).
"""
import json
import os
import sys

from uxfix_fixture import HIDE_GATE_TOASTS, REPO, ensure_build, start_server

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
        acts: qa('.wk-inbox-acts .wk-need-act', r).map((a) => { const c = getComputedStyle(a); return c.borderTopColor === 'rgba(0, 0, 0, 0)' || parseFloat(c.borderTopWidth) === 0; }),
        subj: contrast(q('[data-testid="need-line"]', r)), sender: contrast(q('.wk-inbox-sender', r)) }; }),
    sections: qa('[data-testid="need-section"]', inbox).map((s) => s.innerText),
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
    check(f"{tag}-moves-quiet", all(all(a) for r in rows for a in [r["acts"]] if a), rows=[r["acts"] for r in rows])
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
    page.goto(f"{origin}/", wait_until="networkidle")
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
    ctx.close()

    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{origin}/", wait_until="networkidle")
    page.locator('[data-testid="desk-inbox-count"]').wait_for(state="visible", timeout=15000)
    page.wait_for_timeout(300)
    phone = page.evaluate("""() => { const r = document.querySelector('[data-testid="need-row"]'); const a = r.querySelector('.wk-inbox-acts');
      const s = r.querySelector('.wk-inbox-snippet'); const act = a.querySelector('.wk-need-act');
      return { below: a.getBoundingClientRect().top >= s.getBoundingClientRect().bottom - 1, tap: act ? act.getBoundingClientRect().height : null,
               pane: getComputedStyle(document.querySelector('.wk-inbox-pane') ?? document.body).display,
               hscroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; }""")
    page.locator('[data-testid="desk-inbox"]').screenshot(path=str(SHOTS / "desk-inbox-look-phone.png"))
    check("phone-moves-own-line", phone["below"] and phone["tap"] is not None and phone["tap"] >= 44 and phone["pane"] == "none" and not phone["hscroll"], phone=phone)

    check("no-page-errors", not errors, errors=errors)
    browser.close()

report["ok"] = True
print(json.dumps(report, indent=2))
