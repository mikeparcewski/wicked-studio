## Behavior-first journey list

**Target:** prior redesign output  
**Pass:** pre-build  
**Scope:** large UI/design change  
**Status:** `spec.md` and `prototype.html` are absent, so post-build validation remains pending. No files were edited.

| ID | Priority | Journey | Positive behavior | Negative counterpart |
|---|---:|---|---|---|
| S0 | P0 | Enter the two-state studio | Arrival shows a calm Making canvas; switching to Managing shows exactly Q1/Q2/Q3; returning restores the selected piece and focus context. | No legacy dashboard/sidebar clutter appears; switching state must not leak another engagement’s selection or create duplicate history entries. |
| S1 | P0 | Resolve what needs judgment | Seed unlike and alike decisions. Q2 ranks by consequence, preserves stable order, explains its recommendation, previews the mutation, supports undo, and lets `d` draft a bounded rule. | A newly arriving item does not move the operator’s current target; a failed decision remains visible; an ambiguous group cannot bulk-approve; a rule cannot answer plan-approval or deliver gates. |
| S2 | P0 | Read team performance | With a fixed 14-day corpus, Q1 derives: first-pass acceptance from the first `unit_review` decision; rework from revisions/retries; post-delivery HIGH/CRITICAL escaped defects; observed cost per delivered outcome; median start-to-deliver duration; and deterministic seven-day trends. An off-target sign drills by seat, skill, and work kind. | Missing cost, timestamps, gate kind, or campaign linkage renders “unknown/incomplete,” never zero. Duplicate revision/retry evidence is not double-counted. Empty denominators do not yield false 0%/100% values. Healthy signs do not expand into extra dashboards. |
| S3 | P0 | Improve the system | Q3 presents capture-, evaluation-gap-, override-, and seat-performance-sourced proposals with source evidence, predicted effect, scope, and audit preview. Approve/reject updates only the selected proposal. | Missing provenance blocks approval with an explanation; a failed API decision keeps the proposal; an unsupported daemon state is honest rather than an empty success state. |
| S4 | P0 | Make in flow | Open a document, diagram, board, demo, or code artifact; direct agents through talk or pointing; inspect provenance; accept an agent suggestion and undo it; observe only a true breakthrough at the edge. | Healthy governance and routine activity stay quiet. A held interruption does not steal focus. Undo restores the exact prior suggestion markup and state rather than merely showing a toast. |
| S5 | P0 | Cross into and out of flow | Going in shows where the piece stands, current constraints, and what is delegated. Coming out summarizes team actions, changes to the piece, outstanding judgments, and standing-order activity. | An order never answers a deliver gate, crosses an engagement boundary, sends outbound work without policy, or conceals a failed/held action. |
| S6 | P1 | Compose by talking or pointing | A scoped instruction produces a visible draft/ghost change; commit applies it once; undo restores the prior artifact. Pointer actions and Talk use the same preview/commit path. | Invalid, ambiguous, or out-of-scope instructions produce no mutation. Repeated Enter does not double-submit. Non-reversible actions use explicit typed confirmation rather than promising undo. |
| S7 | P1 | Use Talk and Log without losing scope | Talk clearly names its current piece/engagement; answers, intent, compose, and steer outcomes file into the correct Log; closing and reopening restores the thread. | A project switch cannot retain the previous project’s target. Client detail cannot enter House or another engagement. Closing a sheet/drawer returns focus to its invoker. |
| S8 | P1 | Go one step down | From the active object, open its raw events, evidence, terminal/worktree, configuration, or relevant Part in one action; Back returns to the same state, selection, and scroll position. | Missing or unauthorized data shows a bounded error without losing context. Raw access cannot silently widen from the selected object to unrelated engagements. |
| S9 | P0 | Preserve all platform capability honestly | A static contract verifies all 108 inventory rows have exactly one discoverable home: Making, Q1, Q2, Q3, or one step down. Supported actions map to published HTTP/WS routes. | Crew-not-yet capabilities remain disabled, say “crew: not yet,” name a working alternative, and emit no mutation request. No capability is duplicated, omitted, or presented as operational when unsupported. |
| X1 | P0 | Operate the prototype by keyboard and assistive technology | Every control is reachable; visible focus is maintained; opening a sheet focuses its heading; Escape closes it and restores the invoking control; mode and decision state are announced. | `d` while a sheet is open does nothing and cannot overwrite the saved invoker. Hidden controls are not focusable. Reduced-motion mode avoids essential motion-only feedback. |
| X2 | P1 | Verify calmness and locality | At desktop and narrow widths, the work remains primary, Q1/Q2/Q3 remain legible, and the prototype operates from a local file without external dependencies. | Long labels, missing data, large queues, and 200% zoom do not overlap, truncate essential explanations, create horizontal document scrolling, or depend on network-loaded assets. |

Use a deterministic fixture with a fixed clock, three engagements, healthy and exceptional runs, first-pass/reworked gates, one post-delivery critical finding, partial `cliUsage` data, four proposal sources, cross-client terms, and supported/unsupported routes. Synchronize on rendered state or recorded requests—never sleeps.

Two design ambiguities should be resolved before production:

- The prior output says both “S0–S10” and “ten slices S0–S9.” The enumerated plan is S0–S9; an S10 should not be implied unless it is explicitly defined.
- Q1 must specify deduplication and denominator rules. In particular, a run carrying both `plan.revised` and `retryOf` must not be counted twice accidentally, and absent historical cost must remain unknown.

ADVICE f-66c9107d902b0c32: ACCEPT — added X1 requiring `d` to be ignored while a sheet is open and focus to return to the original invoker.

ADVICE f-9e65bba5b89ca49c: ACCEPT — added S4 requiring accepted suggestions to record real undo state and restore the original content.

ADVICE f-4fa9e8448c814bd5: ACCEPT — added X1 requiring sheet headings to receive opening focus, with invoker focus restored on close.
