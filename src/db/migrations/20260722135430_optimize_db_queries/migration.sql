DROP INDEX IF EXISTS `cms_entry_media_entry_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_media_media_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_collection_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_collection_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_collection_locale_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_created_by_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_tag_entry_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_tag_tag_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_navigation_item_site_key_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_tag_slug_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_invitation_team_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_invitation_email_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_invitation_token_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `email_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_entry_version_entry_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `cms_navigation_redirect_site_key_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `credential_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_membership_team_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_role_team_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_slug_idx`;--> statement-breakpoint
CREATE INDEX `cms_entry_media_media_entry_idx` ON `cms_entry_media` (`mediaId`,`entryId`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_locale_status_created_at_idx` ON `cms_entry` (`collection`,`locale`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_locale_created_at_idx` ON `cms_entry` (`collection`,`locale`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_tag_tag_entry_idx` ON `cms_entry_tag` (`tagId`,`entryId`);--> statement-breakpoint
CREATE INDEX `cms_navigation_item_site_sort_idx` ON `cms_navigation_item` (`navigationKey`,`sortOrder`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_tag_locale_created_at_idx` ON `cms_tag` (`locale`,`createdAt`);--> statement-breakpoint
CREATE INDEX `team_invitation_team_email_idx` ON `team_invitation` (`teamId`,`email`);--> statement-breakpoint
CREATE INDEX `team_invitation_team_pending_idx` ON `team_invitation` (`teamId`,`acceptedAt`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `team_invitation_email_pending_idx` ON `team_invitation` (`email`,`acceptedAt`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `user_created_at_idx` ON `user` (`createdAt`);