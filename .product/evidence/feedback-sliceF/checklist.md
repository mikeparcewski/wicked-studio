# DES-FEEDBACK-001 — Slice F evidence (immersive Document + Video, corrected demo wire)

Feedback items: "Document — the actual document is minimized because of all the left/right
panes"; "Video — seems broken (and same problem as document)". Design: §7.3 (canvas-first
geometry), §7.4 (corrected Video wire), §7.5 (real-bridge contract check).

## Acceptance criteria (§8.3, slice F)

| AC | Evidence | Result |
|---|---|---|
| Document canvas > 80% of viewport width with the thread closed | measured `document-canvas` rect / innerWidth on the built bundle: **0.947** | PASS |
| Version strip auto-hides after 3s idle (opacity 0) | computed `version-strip` opacity after 4.5s idle: **0** | PASS |
| Bottom-proximity wake re-reveals the strip | mouse move to y=880 → strip opacity **0 → 1** | PASS |
| Thread opens as a drawer that REFLOWS the canvas (never covers it) | toggle click → `data-open=true`, drawer mounted, canvas frac **0.947 → 0.642** | PASS |
| Demo player is an IFRAME of the recording (no invented spec fetch) | `demo-player` tagName: **IFRAME** | PASS |
| `getDemoSpec` / invented `/d/:id/api/demo/spec` absent from src | grep AC in `interactive_wire_contract_test.py` step `client_never_spells_invented_wire` | PASS |
| Contract check runs against the REAL wicked-interactive bridge | `WICKED_INTERACTIVE_DIR=… python3 e2e/interactive_wire_contract_test.py` — all steps PASS (`bridge_start`, `create_demo`, `client_url_shapes`, `invented_routes_absent`, `recording_routes_exist`) | PASS |

Advisory from the contract check: `/api/themes` and `/api/theme/learn` 404 on the real
bridge (pre-existing, out of this slice's scope) → filed as studio#65.

## Bug found and fixed during capture (real-user impact)

The strip's absolute wrapper (`zIndex: 3`) kept default `pointer-events: auto`, so after
the strip dimmed, the wrapper's box still shadowed the z-1 `StripSensor`: mouse proximity
could never wake the strip, leaving the thread toggle and version strip permanently
unreachable. Fixed in `DocumentCanvas.tsx` + `VideoStoryboard.tsx` — the wrapper is
`pointer-events: none`; the strip re-enables itself while visible. The proximity-wake row
above is the regression proof (it fails without the fix).

## Named screenshots (e2e/shots/vision/, 1440×900, fresh `dist-sameorigin` build)

- `feedback-F-document-immersive.png` — canvas owns the viewport, strip idle-hidden
- `feedback-F-document-thread-open.png` — drawer open, canvas reflowed, strip awake
- `feedback-F-video-iframe.png` — checkout demo playing in an iframe, storyboard chapters below

## Gates

- eslint `--max-warnings 0`: clean · tsc `--noEmit`: clean · vitest: **93 files / 894 tests passed**
- Full Playwright rig suite re-run on the rebuilt bundle after the pointer-events fix:
  13/13 fixture rigs PASS (uxfix 1–6, vision 1–4/6/7/8, standalone's earlier steps);
  the real-bridge contract rig PASSES with `WICKED_INTERACTIVE_DIR` set. The
  `studio_standalone` rig fails ONLY its slice-7 gate-chips step
  (`run_advanced_on_the_board: false` while REST reports the run `completed`) — a
  negative control on `origin/main` with the identical rig harness fails the same
  step the same way, so it is pre-existing drift outside this slice, filed separately.
