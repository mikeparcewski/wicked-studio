# REQ-005 — Definition of Done Criteria

**Status**: Active  
**Version**: 1.0  
**Product**: wicked-studio  
**Related**: REQ-001, REQ-002, REQ-003, REQ-004, TEST-001, DES-001

---

## Definition of Done — per feature

A feature is Done when:

1. **Implemented** — the feature works end-to-end in the browser against a live crew daemon
2. **Typed** — all new code passes `tsc --noEmit` in strict mode; no new `any` escapes
3. **Tested** — unit tests cover the new API client function(s) and state action(s)
4. **Linted** — `eslint src tests` exits 0
5. **Documented** — the feature's route/panel is mentioned in `README.md` or a `.product/` artifact if it changes the user-visible surface
6. **Reviewed** — automated reviewers (Copilot, Gemini) have run; valid findings addressed

---

## Definition of Done — per release

A release is Done when:

1. **CI green** on the `main` HEAD to be tagged: lint + typecheck + test + build all pass
2. **Wire contract compatible** — `wicked-crew-api-types` version in `package.json` is reachable on npm; typecheck passes against it
3. **E2e evidence committed** — `e2e/studio_standalone_test.py` was run by a team member against a live daemon; `.product/evidence/verdict.json` is committed and dated ≤ 7 days before the tag
4. **No open hard blockers** — RAID.md has no unresolved H (High/Critical) items in the Issues section
5. **Crew upgrade PR** — the `wicked-crew` PR that bumps the `wicked-studio` devDependency is open, linked to this release, and its CI is green before merging

---

## Definition of Done — P9 cross-product

wicked-studio's contribution to the wicked-* P9 DoD:

| Criterion | Evidence |
|---|---|
| REQ docs exist (REQ-001 through REQ-005) | `.product/REQ-*.md` files |
| DES doc exists | `.product/DES-001-technical-design.md` |
| Test strategy exists | `.product/TEST-001-test-strategy.md` |
| RAID exists | `.product/RAID.md` |
| Evidence exists | `.product/evidence/verdict.json` |
| CI green | GitHub Actions `lint · typecheck · test · build` |
| Wire boundary clean | `wicked-studio` devDependencies contain `wicked-crew-api-types`, NOT `wicked-crew` |
| No hard blockers in RAID | RAID Issues section has no unresolved H items |
| Functional e2e run | E2e script executed, result committed as evidence |

---

## What explicitly does NOT block the DoD

- The e2e test running in CI (it requires a live daemon; see TEST-001 and RAID.md I-01)
- Studio having its own npm release (it is distributed through crew; no standalone publish pipeline is required)
- 100% unit test coverage (quality over coverage %; the unit tests cover the wire-consumption layer and state logic — the parts that are testable without a live daemon)
