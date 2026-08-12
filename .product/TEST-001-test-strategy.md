# TEST-001 — wicked-studio Test Strategy

**Status**: Active  
**Version**: 1.0  
**Product**: wicked-studio  
**Related**: REQ-001, DES-001, RAID.md

---

## Scope

This document defines how wicked-studio is verified. Studio is a pure HTTP/WS client SPA — it has no server logic, no database, and no background processes. All its behaviour is expressed in React components, zustand state, and the wire contract it shares with wicked-crew (`wicked-crew-api-types`).

---

## Test Layers

### 1. Unit tests (CI — automated)

**Tool**: Vitest  
**Location**: `tests/`  
**Runs in**: every PR via `.github/workflows/ci.yml` `test` step

Covers:
- State management (zustand slices) — action dispatch, selector correctness, state transitions
- API client functions — request construction, response parsing, error handling
- Utility functions — formatters, type guards, event-shape validators

Currently verified:
```
tests/
  api.test.ts       — API client request/response handling
  auth.test.ts      — token extraction and trust-ladder assertions
  state.test.ts     — run/project/governance store slices
```

**Mutation guard**: change a response-shape assertion to accept a wrong field name — the type guard test must fail. Removes the risk of schema drift being invisible until runtime.

### 2. Type-check (CI — automated)

**Tool**: TypeScript strict mode (`tsc --noEmit`)  
**Runs in**: every PR  

Catches: structural mismatches between `wicked-crew-api-types` wire shapes and the component consumption layer. Because studio ONLY consumes the published `wicked-crew-api-types` package (never crew source), a version bump that changes a type is caught at typecheck, not at runtime.

### 3. Lint (CI — automated)

**Tool**: ESLint + `typescript-eslint`  
**Runs in**: every PR  

### 4. Standalone functional e2e (operator-run)

**Tool**: Playwright (Python)  
**Location**: `e2e/studio_standalone_test.py`  
**CI status**: excluded — requires a live `wicked-crew` daemon binary; structurally impossible to run headless without it. This is an acknowledged design constraint (see RAID.md I-01).

**What it tests**: the full UI flow from launch → connecting to the daemon → listing runs → launching a run → watching events live over WS → gate approval UI → evidence download. Covers the golden path and the three most common operator flows.

**Operator run requirement**: a member of the wicked-studio team must run this script against a live daemon before every tagged release. The run result is captured and committed to `.product/evidence/`. See the Evidence section.

**Run command**:
```bash
# Start crew daemon (separate terminal)
wicked-crew serve --port 4711

# Run standalone e2e
cd /path/to/wicked-studio
pip install playwright
playwright install chromium
python e2e/studio_standalone_test.py
```

---

## Evidence Protocol

Every release must produce a `verdict.json` in `.product/evidence/` from a green operator-run e2e execution. The verdict records:

```json
{
  "run_date": "ISO-8601",
  "operator": "name/alias",
  "studio_version": "0.x.y",
  "crew_version": "0.x.y",
  "e2e_script": "e2e/studio_standalone_test.py",
  "result": "PASS",
  "test_count": 12,
  "notes": "optional notes"
}
```

The verdict is committed before the release tag is pushed. CI does not verify it (no daemon in CI) but the PR gate for release branches requires the file to be present and dated within 7 days of the release.

---

## What is NOT tested here

- wicked-crew daemon correctness — tested in wicked-crew's own suite
- WebSocket protocol correctness — tested in wicked-crew integration tests  
- The `wicked-crew-api-types` wire contract itself — tested in wicked-crew's type tests

Studio's responsibility is that it correctly consumes those surfaces. The type-check layer is the primary enforcement mechanism.

---

## CI matrix

| Step | Tool | Required to merge |
|------|------|-------------------|
| lint | ESLint | ✅ |
| typecheck | tsc --noEmit | ✅ |
| test | Vitest | ✅ |
| build | Vite | ✅ |
| e2e | Playwright | ❌ operator-run only |
