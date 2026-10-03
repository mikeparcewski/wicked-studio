## What

DES-DECISION-CAPTURE slice **DC-S6**: what crew records from the operator's own chat message comes back as one quiet line under it, and the Desk and Needs You say the same thing where it matters.

- **B1** a clear rule auto-remembered: `✓ Remembered for <project>: ‘…’ · Undo · see it`
- **B2** a loose rule: one **Remember** chip — the derived rule, its type, `for <project>`; nothing is stored until the click (the `auth=off` variant is this chip too, Q1)
- **B3** "never mind", a question, a one-off: nothing (the ledger still has it)
- **B4** Undo: `Not remembered` (the rule is retired, never deleted)
- **B6** an approval of a seat's proposal: the chip, with `You approved: “…”` under it; never auto
- **B7** `Already in force · see it`; a paraphrase asks `Same as your rule? · Same · New rule`
- **B8** `You’ve decided this in 2 projects · Make it apply everywhere`
- **B9** the Desk: `One new rule for <project>, from your words — see it`, since you last looked
- **B12** the decision's review proposal sits in Needs You as `From your words — Remember lands a <type> rule: ‘…’`; answering either resolves both

No "Hold work to it" (DC rev 2; DES-rule-check owns it). Under `WICKED_DECISIONS=ledger` nothing is drawn.

## How

- `src/api/decisions.ts` — the DC-S4a / DC-S4b wire (api-types 0.80.0 / 0.84.0), hand-mirrored like `demo.ts` (studio pins api-types 0.40.0); `GET /decisions`, the five POST verbs, the `chatDecisions` / `decisionChanged` frames, the transcript's `decisions` record.
- `src/board/decisionLine.ts` — the words, pure. ORIGIN and the statement come only from a `DecisionView` (crew's ledger).
- `src/store/decisions.ts` — mode read once; a transcript's `decisions` records and live frames land in one turn slot; the chat's ledger views are re-read once per chat so a reload restores the **current** state; one action in flight per decision; a monotonic order (`tick`) guards every merge so a late read never steps a decision back; refusals kept in the daemon's words.
- `DecisionLine.tsx` under the operator's turns in the session thread, `DeskRuleLine.tsx` beside the Desk headline (S12 places these finally); ws frames dispatched from `App`.
- `needsYou.ts` / `proposalTriage.ts` — a policy proposal filed by a decision reads "From your words" only when the ledger's view names that proposal, with the view's statement; a forged payload is an ordinary policy proposal (DC §4.2.4).

## Proof

- `tsc` clean, eslint clean on the touched files.
- vitest: `decisionLine` (B1–B9, B12 words), `decisions.store` (turn slots, reload sync, the late-read races, one post per press, refusals), `DecisionLine` (render + clicks), `needsYou.decisions` (ledger-backed row, forged payload, mismatched proposal, the edit) + the neighbouring needs-you / proposal suites and the inventory guards: green.
- e2e `desk_decisions` (new, in `DESK`): 15/15 steps at 1440×700 under the desk skin on the fixture's new `decisions` switch — scenes 26 / 27 / 44 / 47, the live `chatDecisions` frame, the reload, the `auth=off` chip, ledger mode; screenshots looked at. Re-run green after the rebase onto #465.
- `testid-inventory.json` regenerated (`npm run manifest:testids`).
- codex adjudication, 6 rounds (read-only, base pinned): round 1 found the payload-trusted "From your words" (fixed), the ledger-mode guards (fixed) and transcript snapshots overwriting newer views (fixed); rounds 3–6 chased the stale-read race down to a monotonic order (fixed; round 6: SHIP, no HIGH). One disagreement kept, with codex's agreement: a real pending decision proposal still shows under ledger mode as an **ordinary** policy proposal (it is reviewable state; it just carries no "your words").

## Not in this PR

- S12 (W9) re-places these components in the rebuild's slots; DC-S8 (the considered line, ORIGIN on the rule page) is a later slice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
