CREATE TABLE `cms_entry_media` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`entryId` text NOT NULL,
	`mediaId` text NOT NULL,
	`position` integer,
	`caption` text,
	FOREIGN KEY (`entryId`) REFERENCES `cms_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`mediaId`) REFERENCES `cms_media`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_entry_media_entry_id_idx` ON `cms_entry_media` (`entryId`);--> statement-breakpoint
CREATE INDEX `cms_entry_media_media_id_idx` ON `cms_entry_media` (`mediaId`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_entry_media_entry_media_unique` ON `cms_entry_media` (`entryId`,`mediaId`);--> statement-breakpoint
CREATE TABLE `cms_entry` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`collection` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`slug` text NOT NULL,
	`seoDescription` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`publishedAt` integer,
	`featuredImageId` text,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`featuredImageId`) REFERENCES `cms_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cms_entry_collection_idx` ON `cms_entry` (`collection`);--> statement-breakpoint
CREATE INDEX `cms_entry_status_idx` ON `cms_entry` (`status`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_status_idx` ON `cms_entry` (`collection`,`status`);--> statement-breakpoint
CREATE INDEX `cms_entry_slug_idx` ON `cms_entry` (`slug`);--> statement-breakpoint
CREATE INDEX `cms_entry_created_by_idx` ON `cms_entry` (`createdBy`);--> statement-breakpoint
CREATE INDEX `cms_entry_created_by_status_idx` ON `cms_entry` (`createdBy`,`status`);--> statement-breakpoint
CREATE INDEX `cms_entry_created_at_idx` ON `cms_entry` (`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_status_created_at_idx` ON `cms_entry` (`collection`,`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_collection_created_at_idx` ON `cms_entry` (`collection`,`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_entry_featured_image_idx` ON `cms_entry` (`featuredImageId`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_entry_collection_slug_unique` ON `cms_entry` (`collection`,`slug`);--> statement-breakpoint
CREATE TABLE `cms_entry_tag` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`entryId` text NOT NULL,
	`tagId` text NOT NULL,
	FOREIGN KEY (`entryId`) REFERENCES `cms_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `cms_tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_entry_tag_entry_id_idx` ON `cms_entry_tag` (`entryId`);--> statement-breakpoint
CREATE INDEX `cms_entry_tag_tag_id_idx` ON `cms_entry_tag` (`tagId`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_entry_tag_unique` ON `cms_entry_tag` (`entryId`,`tagId`);--> statement-breakpoint
CREATE TABLE `cms_entry_version` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`entryId` text NOT NULL,
	`versionNumber` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`fields` text DEFAULT '{}' NOT NULL,
	`slug` text NOT NULL,
	`seoDescription` text,
	`status` text NOT NULL,
	`publishedAt` integer,
	`featuredImageId` text,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`entryId`) REFERENCES `cms_entry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`featuredImageId`) REFERENCES `cms_media`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cms_entry_version_entry_id_idx` ON `cms_entry_version` (`entryId`);--> statement-breakpoint
CREATE INDEX `cms_entry_version_entry_id_version_idx` ON `cms_entry_version` (`entryId`,`versionNumber`);--> statement-breakpoint
CREATE TABLE `cms_media` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`fileName` text NOT NULL,
	`mimeType` text NOT NULL,
	`sizeInBytes` integer NOT NULL,
	`bucketKey` text NOT NULL,
	`width` integer,
	`height` integer,
	`alt` text,
	`uploadedBy` text NOT NULL,
	FOREIGN KEY (`uploadedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_media_bucketKey_unique` ON `cms_media` (`bucketKey`);--> statement-breakpoint
CREATE INDEX `cms_media_mime_type_idx` ON `cms_media` (`mimeType`);--> statement-breakpoint
CREATE INDEX `cms_media_created_at_idx` ON `cms_media` (`createdAt`);--> statement-breakpoint
CREATE INDEX `cms_media_uploaded_by_idx` ON `cms_media` (`uploadedBy`);--> statement-breakpoint
CREATE TABLE `cms_navigation_item` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`navigationKey` text NOT NULL,
	`parentId` text,
	`nodeType` text NOT NULL,
	`title` text NOT NULL,
	`entryId` text,
	`slugSegment` text,
	`resolvedPath` text,
	`sortOrder` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`entryId`) REFERENCES `cms_entry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `cms_navigation_item_site_key_idx` ON `cms_navigation_item` (`navigationKey`);--> statement-breakpoint
CREATE INDEX `cms_navigation_item_parent_id_idx` ON `cms_navigation_item` (`parentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_navigation_item_site_path_unique` ON `cms_navigation_item` (`navigationKey`,`resolvedPath`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_navigation_item_site_parent_sort_order_unique` ON `cms_navigation_item` (`navigationKey`,`parentId`,`sortOrder`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_navigation_item_site_entry_unique` ON `cms_navigation_item` (`navigationKey`,`entryId`);--> statement-breakpoint
CREATE TABLE `cms_navigation_redirect` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`navigationKey` text NOT NULL,
	`fromPath` text NOT NULL,
	`toPath` text NOT NULL,
	`statusCode` integer DEFAULT 307 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `cms_navigation_redirect_site_key_idx` ON `cms_navigation_redirect` (`navigationKey`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_navigation_redirect_site_from_path_unique` ON `cms_navigation_redirect` (`navigationKey`,`fromPath`);--> statement-breakpoint
CREATE TABLE `cms_tag` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`color` text,
	`createdBy` text NOT NULL,
	FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_name_unique` ON `cms_tag` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `cms_tag_slug_unique` ON `cms_tag` (`slug`);