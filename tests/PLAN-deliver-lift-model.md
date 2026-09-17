# PLAN — deliverLiftModel unit tests

Target: `src/components/deliverLiftModel.ts`  
Harness: vitest (jsdom) — `./node_modules/.bin/vitest run <file>`  
Output: `tests/deliverLiftModel.test.ts`

## Execution table

| Row | Status | Evidence |
|---|---|---|
| `tests/deliverLiftModel.test.ts` (43 tests) | covered | `./node_modules/.bin/vitest run tests/deliverLiftModel.test.ts` → **43 passed** exit 0 |
| Full suite regression | covered | `npm test` → **3363 passed / 305 files** exit 0 |
| Typecheck | covered | `npm run typecheck` → exit 0 (no errors) |
| Lint | covered | `npm run lint` → exit 0 (no errors) |

## Test inventory

### deliverLift — story lifecycle (10 tests)
| Test | Behaviour |
|---|---|
| empty event log → null | `deliverLift([], 5)` and `deliverLift([])` both null |
| log with no deliver story → null | unrelated event types/ords → null (scoped and unscoped) |
| deliverLiftEvaluated starts a story | ord propagated; works with and without explicit deliverOrd |
| outcome word kept verbatim | all five tokens: unchanged/lifted/conflict/skipped/failed |
| all view fields populated | outcome/baseRef/baseBefore/baseAfter/treeBefore/treeAfter/conflicts/note/reverify/failure |
| deliver: stepFailed without deliverOrd → null | unscoped fold never starts from a stepFailed |
| deliver: stepFailed with deliverOrd → view outcome=null | refused-before-lift inline case |
| non-deliver: stepFailed with deliverOrd, no prior lift → null | generic worker error not adopted |
| repoChecksEvaluated before lift → not attached | floor before lift frame is ignored |
| repoChecksEvaluated after lift → reverify attached | passed/checks/skipped propagated |

### deliverLift — refused-before-lift shape (1 test)
| Test | Behaviour |
|---|---|
| STEP_FAILED_WRONG_HEAD with deliverOrd=5 | wire fixture: outcome=null, failure=DETAIL_WRONG_HEAD, no reverify, conflicts=[] |

### deliverLift — retry reset / unitDispatched (2 tests)
| Test | Behaviour |
|---|---|
| conflict clears after dispatch | attempt 0 conflict → dispatch → attempt 1 unchanged: conflicts=[], attempt=1 |
| reverify attaches to new attempt lift | dispatch → new lift → repoChecksEvaluated: reverify on attempt 1 |

### liftOutcomeLabel (3 tests)
| Test | Behaviour |
|---|---|
| all five engine tokens | each maps to its label string |
| null → 'refused before the lift' | |
| unknown token passthrough | forward-compat with newer engine tokens |

### liftIsFailure (7 tests)
| Test | Behaviour |
|---|---|
| conflict → true | |
| failed → true | |
| failure≠null → true | outcome=null with failure set |
| reverify.passed=false → true | lifted with failing reverify |
| unchanged → false | |
| lifted + passing reverify → false | |
| skipped → false | |

### reverifyChangedTree (7 tests)
| Test | Behaviour |
|---|---|
| passed=false, all exit 0, no skipped → true | post-check proof failure |
| non-zero exit → false | |
| passed=true → false | |
| has skipped → false | |
| checks=[] → false | |
| one timedOut → false | |
| one spawnError → false | |

### splitElided / ELISION_MARKER (5 tests)
| Test | Behaviour |
|---|---|
| no marker → one element | plain text |
| DETAIL_REVERIFY_FAILED → three elements | wire fixture: head / marker / tail |
| odd indices match ELISION_MARKER | synthetic marker |
| even indices are kept words verbatim | 'HEAD\n' and '\nTAIL' |
| empty string → [''] | |

### textCarriesFailure (8 tests)
| Test | Behaviour |
|---|---|
| null text → false | |
| undefined text → false | |
| null failure → false | |
| non-elided failure in worker-failure framing → true | DETAIL_WRONG_HEAD in deliverWorkerFailedReason |
| elided failure in triage retry prompt → true | DETAIL_REVERIFY_FAILED in deliverRetryPrompt |
| head segment not in unrelated text → false | negative case |
| empty text, non-null failure → false | |
| whitespace-only kept segments → false | only marker, no surrounding words |

## Not covered

None — all exported functions and their advertised behaviours are covered by the 43 tests above. No UI rendering (the module is pure), no async, no external requests.

## External transforms

ASSUMPTION[external-transform] library=none transform=none confidence=known :: `deliverLiftModel.ts` is a pure fold over `CoreEvent[]`. The only imported dependency is `floorOf` from `gateVerdictModel.ts`, which narrows a `repoChecksEvaluated` event into a `GateFloorView` — a same-package pure function, not a third-party transform.
