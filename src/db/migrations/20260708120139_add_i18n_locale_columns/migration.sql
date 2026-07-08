ALTER TABLE `cms_entry` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `cms_entry` ADD `sourceContentHashes` text;--> statement-breakpoint
ALTER TABLE `cms_navigation_item` ADD `titleTranslations` text;--> statement-breakpoint
ALTER TABLE `cms_tag` ADD `locale` text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `preferredLocale` text(10);--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_collection_slug_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_tag_name_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_tag_slug_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `cms_entry_collection_slug_locale_unique` ON `cms_entry` (`collection`,`slug`,`locale`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_locale_status_idx` ON `cms_entry` (`collection`,`locale`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_name_locale_unique` ON `cms_tag` (`name`,`locale`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_slug_locale_unique` ON `cms_tag` (`slug`,`locale`);--> statement-breakpoint
CREATE INDEX `cms_tag_slug_idx` ON `cms_tag` (`slug`);