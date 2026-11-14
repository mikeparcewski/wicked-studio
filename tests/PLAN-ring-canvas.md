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
| RL-2 | the drawn radii strictly increase | deterministic | covered (graphRingCanvas.test.ts) |
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
| LB-3 | priority order (partial): focus > selected > level 1, and a guide loses to a colliding node | deterministic | covered (graphRingLabels.test.ts) |
| LB-4 | LOD applies to `symbol` only — a ring-2 symbol drops below the zoom floor; a group stays | deterministic | covered (graphRingLabels.test.ts) |
| LB-5 | worked fixture: focus + all 9 level-1 labels shown at every zoom 0.3→1.0 step 0.05, no overlaps | deterministic | covered (graphRingLabels.test.ts) |
| LB-6 | labelGeom truncates a radial label at 24 chars with an ellipsis | deterministic | covered (graphRingLabels.test.ts) |
| LB-7 | labelGeom flips rotation by π on the left half; focus horizontal below, guide horizontal above | deterministic | covered (graphRingLabels.test.ts) |

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

---

## Area 4 — Token helpers and hop-colour contrast

Source: `tests/resolveToken.test.ts`, `tests/graphLevelTokens.contrast.test.ts`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| TK-1 | F3 — `resolveTokenPx` returns the token's pixel value by inheriting it, not a container width | deterministic | covered (resolveToken.test.ts) |
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

Result: **Test Files 7 passed (7) · Tests 84 passed (84) · exit 0** — every scenario above executed
and passed; nothing skipped. The full repository suite (`npm test`) is green on a clean checkout
(746 files, 9355 passed, 1 skip only when no base ref is supplied — the `testidRemovals` merge-base
guard, which runs green with the base pinned as above and in CI).
