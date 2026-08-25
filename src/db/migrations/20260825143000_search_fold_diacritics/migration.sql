--> CUSTOM MIGRATION CODE
-- `unicode61` alone case-folds but leaves the diacritics of any codepoint its table cannot reach in
-- one byte, so `documentacion` did not find `Documentación` and `lieu` did not find `liệu`. Mode 2
-- strips them all. FTS5 folds both the stored text and the MATCH query itself, so
-- `tokenizeSearchQuery` in src/lib/cms/search-tokens.ts only splits and lowercases the query. The
-- in-memory docs-route half has no FTS5, so `tokenizeIndexText` does the same fold in JavaScript.
--
-- `slug` is indexed, not UNINDEXED: the route half matches a page by the words of its URL, and the
-- CMS half must do the same. See the bm25 weights in src/lib/cms/cms-search.ts.
--
-- Dropped rather than migrated: `tokenize` is fixed at creation, and this table is a derived index.
-- The table starts empty. Run `rebuildCmsSearchIndex` for each searchable collection after you
-- deploy: a publish before that leaves one row, and the lazy rebuild then skips the collection.
DROP TABLE `cms_entry_search`;--> statement-breakpoint
CREATE VIRTUAL TABLE `cms_entry_search` USING fts5(
	`entryId` UNINDEXED,
	`collection` UNINDEXED,
	`slug`,
	`title`,
	`seoDescription`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
