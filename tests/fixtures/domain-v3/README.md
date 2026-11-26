# domain-v3 fixtures (J6 S1)

Real-shape fixtures: each file is crew's own answer shape, made by crew's own mapper from the real writers' output.
None is hand-written.

| File | Made by | From |
|---|---|---|
| `model-built.crew.json` | wicked-crew `domainModelOf` (`packages/crew/src/api/domain-model.ts`, PR 1909 head `e469c20`): the `model` field of `GET /repos/:id/requirements` | crew's `tests/fixtures/domain-v3/model-built.json`, the document wicked-core `domain-graph --out` built from core's `tests/fixtures/domain_v3/mini-cobol` fixture (core PR 1922) |
| `model-after-rulings.crew.json` | the same `domainModelOf` | crew's `model-after-rulings.json`: the same model after three `domain-ruling` calls (a statement confirmed, one rejected, a target confirmed) |
| `scope-mini-cobol.crew.json` | wicked-crew `scopeCardOf` (`packages/crew/src/api/domain-scope.ts`, same head): `POST /runs/preview`'s `scopeCard` | crew's `scope-mini-cobol.json`, garden `scripts/domain/scope.py` over the same tree |

Made with `tsx` in crew's `packages/crew`: read each source file, run the mapper, `JSON.stringify(…, null, 2)`.
