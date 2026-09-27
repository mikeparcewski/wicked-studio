Reading the brief and design docs to scope this redesign task.Now let me look at the existing src structure and the capabilities inventory.Let me check the key existing src files to accurately understand the scope.I have read all the necessary inputs. This is a design-phase run — the brief, prior exploration doc, capabilities inventory, and all 338 src files are consumed read-only. The run produces two new documents only.

**What this run creates:**
- `docs/design/studio-redesign/spec.md` — the two-state spec with vital signs, governance model, capability homes, and the S0–S10 behaviour-first build plan
- `docs/design/studio-redesign/prototype.html` — clickable local prototype (the calm-design walk-through, analogous to `docs/design/orchestrator-console-prototype.html`)

**What this run edits:** nothing — all existing src, board, store, components, tests, and e2e files are read only at this stage.

**What this run deletes:** nothing.

Implementation touches (S0–S10 slices) are described inside the spec's build plan and execute as separate governed runs after operator approval.

SCOPE {"touch":["docs/design/studio-redesign/spec.md","docs/design/studio-redesign/prototype.html"]}