# anti-slop provenance

- Source: https://github.com/dmmulroy/anti-slop
- Commit: `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b`
- Copied from: `skills/install-anti-slop/assets/anti-slop` (identical to `src/` at that commit, tests not included)
- Installed with: `skills/install-anti-slop/scripts/install.mjs tools/oxlint/anti-slop`
- Entry point: `tools/oxlint/anti-slop/index.ts`, registered in `.oxlintrc.json` under `jsPlugins`
- Runtime dependency: `@oxlint/plugins`, pinned to the exact `oxlint` version in `package.json`

## Local deviations

- Removed `effect/`. This project does not depend on Effect, and fallow reported the files as unused.
- Removed the rules that are not enabled (see the table below), `shared/dictionary-types.ts`, and
  `vendor/eslint-stylistic/`. Only those rules used these helpers. `index.ts` registers only the enabled rules.
- Removed the helpers that only the removed rules used: `containsUnknownType` in `shared/function-parameters.ts`,
  and `hasVisibleTypeBinding` in `shared/type-alias-resolution.ts`. `visibleTypeAlias` is no longer exported.
- No rule source is changed.

## Enabled rules

`.oxlintrc.json` enables these rules at `error`:

- `oxc/no-accumulating-spread` (native companion rule)
- `no-reduce-accumulator-copy`
- `no-chained-type-assertions` (off for `*.test.ts`, `*.test.tsx`, and `tests/**`, because test doubles stand in for partial SDK clients)
- `no-object-parameters`
- `no-reflect-apply`
- `no-reflect-get`
- `no-unknown-type-aliases`
- `no-widen-then-assert`

## Rules not enabled

Counts are from the first run on this repository. These rules are not in this directory.

| Rule | Findings | Reason |
| --- | ---: | --- |
| `require-readable-spacing` | 2,747 | A blank-line style change in about 580 files. It makes upstream merges harder for forks of this template. |
| `require-safety-comment-for-type-assertion` | 751 | Conflicts with the project rule to comment only non-trivial logic. |
| `no-module-mocking` | 409 | The unit tests use `vi.mock` by design. |
| `no-runtime-typeof` | 178 | Most hits narrow dynamic data: Tiptap JSON, drag data, and caught errors. |
| `no-unsafe-dictionary-type` | 143 | Same reason as `no-runtime-typeof`. |
| `no-unknown-parameters` | 103 | Same reason as `no-runtime-typeof`. |
| `no-known-value-widening` | 85 | Same reason as `no-runtime-typeof`. |
| `no-conditional-empty-object-spread` | 44 | The omitted keys are intentional in Stripe, MCP, Drizzle, and ProseMirror payloads. |
| `no-unknown-returns` | 29 | Most hits are `() => Promise<unknown>` callback contracts, which are correct. |
| `no-array-filter-map` | 18 | A speed rule, but every flagged array is small, and the rewrites read worse. |
| `no-shape-in-symbol-names` | 4 | A naming preference that finds no bugs, and "shape" is a common term in API code. |

## Fallow

`.oxlintrc.json` loads `index.ts`, and `index.ts` imports `@oxlint/plugins`, so fallow tracks the
dependency. `.fallowrc.jsonc` hides the health and duplication findings for this directory, because
upstream owns that code. Dead-code findings still apply: when a removed rule leaves a helper unused, remove it.

## Enable a rule

1. Copy the rule file and each `shared/` or `vendor/` file it imports from the upstream commit above.
2. Register the rule in `index.ts`, and turn it on in `.oxlintrc.json`.
3. Move the rule from "Rules not enabled" to "Enabled rules".
4. Run `pnpm run lint`, `pnpm run typecheck`, and `pnpx fallow dead-code`.

## Update procedure

1. Copy the new upstream assets to a temporary directory. Do not overwrite this directory.
2. Diff them against the commit above, and apply the upstream changes here.
3. Apply upstream changes only to the files in this directory. Keep the deviations above, and update the commit.
4. Run `pnpm run lint`, `pnpm run typecheck`, and `pnpx fallow dead-code`.
