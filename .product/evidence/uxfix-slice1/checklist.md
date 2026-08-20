# DES-UXFIX-001 slice 1 — experience checklist verdicts

**Slice:** attention decay + board bands (answers F3, F5; serves W2, W4)
**Rubric:** DES-UXFIX-001 §4.1, items mapped to this slice: EC3, EC4, EC5 (EC10 re-read
opportunistically per the slice design §5.6).
**Images:** `e2e/shots/uxfix/uxfix-1-messy-board.png` (full W2 board, QUIET collapsed),
`e2e/shots/uxfix/uxfix-1-quiet-expanded.png` (same board, QUIET expanded) — captured at
1440×900, `device_scale_factor=1`, per §4.0, by `e2e/uxfix_slice1_test.py` against the
frozen-`NOW0` W2 fixture (§4.2). The shots are gitignored evidence; the rig's JSON report
records each shot's path beside the DOM verdicts.

| Item | Verdict | Read from the image |
|---|---|---|
| **EC3** — needs-me is distinct from history | **PASS** | In `uxfix-1-messy-board.png`, the accent NEEDS YOU band label and the gate chips (`gate [Approve] [Reject]`, `gate [Answer ›]`) are the highest-contrast elements on screen. The quiet majority is one demoted chip line each (`○ notes · 2d`, `○ legacy-spike · 8d`, …) under its own muted QUIET (24) label. |
| **EC4** — no stale item leads | **PASS** | Same image: `legacy-spike` (8-day failure) is not in the live band — it appears only as a quiet chip labelled `8d` — while `upload-endpoint` sits in NEEDS YOU streaming its live narration line. The 12-minute failure (`auth-refactor`) still leads it; both gates lead everything. Legible from the ordering alone, without the DOM. |
| **EC5** — no junk leads | **PASS** | Both images: no band above the real projects belongs to the shelf; "Not in a project" is last in document order, collapsed, absent entirely when nothing is unfiled (DOM-asserted by the rig), and the word "Unfiled" appears nowhere on the surface. |
| **EC10** — no banned state (opportunistic) | **PASS** | Neither shot contains a bare spinner, a bare "Working…", whimsy, or an error without a next action. Every live line names its subject (`build — Writing the token-bucket middleware for /upload`). |

Not judged here (out of this slice's mapping, per §5.6): EC2 (absence budget) and EC6
(differentiated verbs) — the expanded QUIET band deliberately shows today's full card,
including its "No documents yet." lines and the four same-named quick actions; both are
slice 2's deliverables (D5, R6).

**Mechanism verdicts** (the DOM half, from the rig's JSON report, all true):
needs-you order `q3-review-deck → api-migration → auth-refactor → upload-endpoint`;
`legacy-spike` demoted by its 8-day durable-log tail despite a 1-hour-old
`project.updated_at` (the R3 trap, exercised for real); an 8-day-old gate still scores
100.00 and leads; band ⇄ threshold agreement on every mounted card; board height 844px ≤
900, document height 900 ≤ 900, 13 cards mounted of 28 projects with QUIET expanded.
