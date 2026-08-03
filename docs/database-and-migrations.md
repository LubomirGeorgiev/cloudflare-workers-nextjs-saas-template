# Database and migrations

The day-to-day rules are in `AGENTS.md`. This is the reasoning behind them, plus the two procedures
too long to keep in an agent's context: understanding a generated table rebuild, and merging an
upstream template migration into a fork.

## Why D1 schema changes are dangerous

SQLite can only alter a table in place for a tiny whitelist of operations — rename a table, rename
a column, add a nullable unconstrained column, create/drop independent indexes/triggers/views.
Almost any other change to an existing table (types, nullability, defaults, PKs, unique/check
constraints, FKs, `STORED` generated columns, dropping columns) makes `drizzle-kit` emit a full
replacement-table migration: create a `__new_*` table, copy every row, drop the old table, rename.

On D1 that rebuild is dangerous. FK enforcement stays active during migrations — `DROP TABLE` can
fire `ON DELETE` cascades, and the generated `PRAGMA foreign_keys=OFF` does not help — and the
single `INSERT ... SELECT` copy can blow D1's 30-second query limit.

## The rules that follow

- Never introduce database-level defaults: no Drizzle `.default(...)` / SQL `DEFAULT`, including on
  new tables. Supply values on every insert; a runtime `$defaultFn()` is fine. Don't remove an
  existing production default just to comply — that itself rebuilds the table.
- Prefer independent `index()`/`uniqueIndex()` over schema-level `.unique()` unless the key is a
  primary/FK invariant: index changes only touch the index; constraint changes rebuild the table.
- New columns must be nullable and unconstrained (no `NOT NULL`, `PRIMARY KEY`, `UNIQUE`, or
  `STORED` on a populated table). Treat `DROP COLUMN` and generated-column changes as destructive;
  check dependent indexes, constraints, triggers, and views first.
- Keep migrations pure schema: batch large data backfills separately, and no `VACUUM`/`REINDEX`
  (use `PRAGMA optimize` if maintenance is needed).
- If a production rebuild is genuinely unavoidable, get explicit user approval first, with a
  documented backup/Time Travel recovery point and rollback plan.
- Re-audit this behavior whenever `drizzle-kit` is upgraded.

## The tripwire

After `pnpm db:generate`, read the full generated SQL and the snapshot diff. If it contains
`CREATE TABLE __new_*`, `INSERT INTO __new_* ... SELECT`, `DROP TABLE`, `PRAGMA foreign_keys=OFF`,
or a `DROP COLUMN`/`ADD COLUMN` replacement pair — stop, do not apply or deploy.

A rebuild in the diff almost always means schema/snapshot/history drift rather than a change that
genuinely requires one. Find the drift, fix the source, and regenerate. Never hand-edit rebuild
statements out of a generated migration, and never use `PRAGMA legacy_alter_table` or
`defer_foreign_keys` to force one through.

## One migration per commit

A commit must never contain multiple new migrations unless a human is explicitly asked and gives
permission. Without it, consolidate before committing: delete the incremental migration files,
regenerate a single migration from the final schema, and reset/re-migrate local dev DB state so its
journal matches.

That covers migrations you authored. Migrations arriving from an upstream template merge follow the
next section instead.

## Merging template migrations into a fork

Each `snapshot.json` records the whole schema, so an upstream migration arrives describing a
database without the fork's tables; merged as-is it truncates the lineage and the next
`pnpm db:generate` recreates existing tables.

- Keep the incoming `migration.sql` and directory names untouched. Fix the merge by rebasing only
  `snapshot.json`: replay each migration's entity delta onto the fork's newest snapshot,
  oldest-first, and re-point `prevIds` while keeping the upstream `id` values.
- Take the delta baseline from the template ref, never the fork's same-id snapshot; they differ in
  content and getting it wrong fails silently.
- Done when `drizzle-kit check` and `pnpm db:generate` report no drift and `pnpm run test:e2e`
  replays the chain. If the upstream SQL assumes a schema the fork lacks, consolidate into one
  regenerated migration instead and re-add its data statements.

## References

- [SQLite ALTER TABLE](https://www.sqlite.org/lang_altertable.html)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
