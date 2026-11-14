# Ring-canvas acceptance test plan

Covers **Graph rings, part 2: the ring canvas** — `src/components/graph/RingGraph.tsx`,
the shared geometry in `src/components/graph/cytoBase.ts`, the hop-colour tokens, and the
`resolveToken` helpers. Every scenario below is a **deterministic tool check** (vitest, headless
cytoscape / jsdom, a checked-in advance table for label geometry — no live renderer, no daemon); a
governed agent run would add nothing because none of these needs a non-deterministic decision during
the test. RepoGraphModal does not use the canvas yet, so there is no browser journey in this slice.

Legend: **covered** = a scenario already asserted by the cited test file:line. Every row here is
covered and executed — see the execution record at the end.

---

## Area 1 — Ring layout (concentric + radius transform)

Source: `tests/graphRingCanvas.test.ts`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| RL-1 | every item of level k sits at radius r_k (±0.5) | deterministic | covered (graphRingCanvas.test.ts) |
| RL-2 | the drawn radii strictly increase, **measured on the laid-out positions** (mean placed radius per level increases and matches model.radii[k] ±0.5) | deterministic | covered (graphRingCanvas.test.ts, "the drawn radii strictly increase, measured on the laid-out positions") |
| RL-3 | no item sits at 12 o'clock (angle shifted by π/n_k) | deterministic | covered (graphRingCanvas.test.ts) |
| RL-4 | each guide ring is 2·r_k across — the mounted guide node's data(diameter) + rendered width()/height() = 2·r_k | deterministic | covered (RingGraph.test.tsx, "guide rings are 2·r_k across") |
| RL-5 | radii increase across a gap {0,1,3} (empty ring 2) | deterministic | covered (graphRingCanvas.test.ts) |
| RL-6 | radii increase across a gap {0,3} (ring 3 beyond ring 0) | deterministic | covered (graphRingCanvas.test.ts) |

---

## Area 2 — Label geometry, collision, LOD (pure placement function)

Source: `tests/graphRingLabels.test.ts`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| LB-1 | oriented-rectangle (SAT) collision vs axis-aligned for diagonal labels | deterministic | covered (graphRingLabels.test.ts) |
| LB-2 | two overlapping oriented rectangles are detected | deterministic | covered (graphRingLabels.test.ts) |
| LB-3 | priority order (partial): focus > selected/**hovered** > level 1, and a guide loses to a colliding node; the hovered-ring label wins a collision over a dimmed one of equal base rank | deterministic | covered (graphRingLabels.test.ts; RingGraph.test.tsx, "F3: a hovered ring's labels win a collision over dimmed labels of equal base rank") |
| LB-4 | LOD applies to `symbol` only — a ring-2 symbol drops below the zoom floor; a group stays | deterministic | covered (graphRingLabels.test.ts) |
| LB-5 | worked fixture: focus + all 9 level-1 labels shown at every zoom 0.3→1.0 step 0.05, no overlaps | deterministic | covered (graphRingLabels.test.ts) |
| LB-6 | labelGeom truncates a radial label at 24 chars with an ellipsis | deterministic | covered (graphRingLabels.test.ts) |
| LB-7 | labelGeom flips rotation by π on the left half; focus horizontal below, guide horizontal above | deterministic | covered (graphRingLabels.test.ts) |
| LB-8 | F8 — an empty-text input is never placed: not shown, not counted, and does not suppress an overlapping non-empty label | deterministic | covered (graphRingLabels.test.ts, "empty-text labels are never placed") |

---

## Area 3 — RingGraph component (data attributes, theme, selection/hover)

Source: `tests/RingGraph.test.tsx`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| RG-1 | data attributes mirror the model (view / visible / symbols / levels / open-level / edges / focus / aria) | deterministic | covered (RingGraph.test.tsx) |
| RG-2 | an explicit `ariaLabel` overrides the default | deterministic | covered (RingGraph.test.tsx) |
| RG-3 | a theme mutation calls `cy.style()` and never re-runs the layout | deterministic | covered (RingGraph.test.tsx) |
| RG-4 | hoverLevel dims every other level; a selection with no hover dims nothing | deterministic | covered (RingGraph.test.tsx) |
| RG-5 | `data-focus-color` tracks a changed `--accent` across a theme change | deterministic | covered (RingGraph.test.tsx) |
| RG-6 | a tap on an activatable node calls onSelect and onActivate | deterministic | covered (RingGraph.test.tsx) |
| RG-7 | F1 — a model-only rerender does not swallow the next selection or hover change | deterministic | covered (RingGraph.test.tsx) |
| RG-8 | F2 — a later refresh keeps label priority on the current selection, not the build-time one | deterministic | covered (RingGraph.test.tsx) |
| RG-9 | F4 — a primary edge keeps its per-level hop colour; a secondary edge stays ink-dim | deterministic | covered (RingGraph.test.tsx) |
| RG-10 | P1 (POL-2101) — a model id with `:`, `/`, `%`, `.`, `#`, a space and a quote is used verbatim, selectable, chained, reported | deterministic | covered (RingGraph.test.tsx) |
| RG-11 | F1 — hover dimming never lands on the selection or its selected chain (focus-selected stays lit; a selected level-2 node and its chain are not dimmed) | deterministic | covered (RingGraph.test.tsx, "F1: hover dimming never lands on the selection or its selected chain") |
| RG-12 | F2 — edge hover dimming compares the real colorLevel, not the 1..5 colour clamp (level 6/7 edges dim on hover 5; the level-5 edge dims on hover 6) | deterministic | covered (RingGraph.test.tsx, "F2: edge hover dimming compares the real colorLevel") |
| RG-13 | F3 — a hovered ring's labels win a collision over dimmed labels of equal base rank; swapping the hover swaps the winner | deterministic | covered (RingGraph.test.tsx, "F3: a hovered ring's labels win a collision") |
| RG-14 | F5 — a hover-only change never refits (zoom/pan untouched, no animation); a selection calls cy.stop() before cy.animate() and writes data-selected-xy synchronously | deterministic | covered (RingGraph.test.tsx, "F5: hover never refits; a selection stops the prior animation") |
| RG-15 | F6 — a label-only prop change updates aria-label and survives a zoom refresh; a pending setTimeout frame is cleared on unmount; a failed getContext is cached (one measure canvas) | deterministic | covered (RingGraph.test.tsx, "F6: lifecycle — aria-label ref, pending-frame cleanup, cached measure canvas") |
| RG-16 | F7 — the mounted canvas lays every non-guide node on its model radius (hypot ≈ model.radii[level] ±0.5) and shifts a single node off 12 o'clock | deterministic | covered (RingGraph.test.tsx, "F7: the mounted canvas lays nodes on their model radii, off 12 o'clock") |

---

## Area 4 — Token helpers and hop-colour contrast

Source: `tests/resolveToken.test.ts`, `tests/graphLevelTokens.contrast.test.ts`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| TK-1 | F3 — `resolveTokenPx` returns the token's pixel value by inheriting it, not a container width | deterministic | covered (resolveToken.test.ts) |
| TK-1b | F4 — a `display:none` probe reports the computed value: a 0.75rem token on a 16px root → 12, an unset token → NaN (never the laid-out container width); `resolveTokenValue` returns a set token's value and '' for an unset one | deterministic | covered (resolveToken.test.ts, "resolveTokenPx (F4)", "resolveTokenValue (F4)") |
| TK-2 | each `--graph-level-*` clears 3:1 on `--surface-base` and `--surface-rail`, wicked-dark + wicked-light | deterministic | covered (graphLevelTokens.contrast.test.ts) |
| TK-3 | adjacent levels ≥0.08 ΔE_OK apart; each level ≥0.10 ΔE_OK from every status colour | deterministic | covered (graphLevelTokens.contrast.test.ts) |

---

## Area 5 — Guards that must stay green

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| GD-1 | `typeScale.lint` — six sizes, two weights, one tracking; no raw font-size/weight/tracking; no uppercase | deterministic | covered (typeScale.lint.test.ts) |
| GD-2 | `testidRemovals` — no testid removed since the merge base without a declared successor | deterministic | covered (testidRemovals.test.ts, base pinned) |

---

## Execution record

Command (base pinned so `testidRemovals` runs instead of skipping):

```
TESTID_BASE_REF=bf0c2055f5c2be9f13cc4a9a9c1e96fede6a16c0 \
  npx vitest run --maxWorkers=2 \
  tests/graphRingCanvas.test.ts tests/graphRingLabels.test.ts tests/RingGraph.test.tsx \
  tests/graphLevelTokens.contrast.test.ts tests/resolveToken.test.ts \
  tests/typeScale.lint.test.ts tests/testidRemovals.test.ts
```

Result: **Test Files 7 passed (7) · Tests 100 passed (100) · exit 0** — every scenario above executed
and passed; nothing skipped. The full repository suite (`npm test`) is green on a clean checkout
(746 files, 9355 passed, 1 skip only when no base ref is supplied — the `testidRemovals` merge-base
guard, which runs green with the base pinned as above and in CI).
