# REQ-004 — Ways of Working

**Status**: Active  
**Version**: 1.0  
**Product**: wicked-studio  
**Related**: REQ-001, DES-001, wicked-crew ADR-STUDIO-DEP-001

---

## Repository

| Item | Value |
|---|---|
| Repo | `mikeparcewski/wicked-studio` |
| Default branch | `main` |
| Branch protection | Required status checks: lint, typecheck, test, build |
| Review policy | Automated reviewers (Copilot, Gemini) + CI; owner merge via `--admin` when all pass |
| PR merge rule | Never merge immediately — wait 6-8 min for automated reviewers to post, then address valid findings |

## Release

Studio does NOT have its own release pipeline. It is **distributed through wicked-crew** via the `build:with-studio` npm script. The release flow is:

1. Merge to `main` — CI validates lint/typecheck/test/build
2. Crew maintainer runs `npm run build:with-studio` in `wicked-crew` to bundle studio's `dist/` into the crew package
3. Crew publishes a new tagged release — studio is included automatically

Studio's `package.json` version is bumped when crew explicitly upgrades its `wicked-studio` devDependency.

## Wire contract

The only interface between studio and crew is the `wicked-crew-api-types` npm package. PRs that change any shape in `wicked-crew-api-types` must be coordinated with studio's consumption of those shapes. Breaking changes require a major version bump.

## Code style

| Rule | Tool |
|---|---|
| No `any` | typescript-eslint |
| Consistent imports | ESLint import order |
| Component naming | PascalCase; file name matches export |
| State slices | One slice per domain entity (runs, projects, governance) |
| No direct fetch in components | All HTTP goes through the API client in `src/api/` |

## Testing expectations

- Every new API client function gets a unit test
- Every new state action gets a unit test
- The operator-run e2e (`e2e/studio_standalone_test.py`) must pass on the commit that is tagged for release
- Evidence (`verdict.json`) must be committed before the crew upgrade PR is merged

## Coordination with crew

| Event | Action |
|---|---|
| `wicked-crew-api-types` minor bump | Update `package.json`, run typecheck, update consumption code if needed |
| `wicked-crew-api-types` major bump | Treat as a breaking change; audit all type guard code |
| New CoreEvent type in crew | Add a handler in studio's WS reducer; add a unit test |
| crew gateway path change | Update `src/api/client.ts` base paths; update the e2e script |
