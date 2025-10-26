CREATE TABLE `cms_entry_media` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`entryId` text NOT NULL,
	`mediaId` text NOT NULL,
	`position` integer,
	`caption` text,
	FOREIGN KEY (`entryId`) REFERENCES `cms_entry`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mediaId`) REFERENCES `cms_media`(`id`) ON UPDATE no action ON DELETE no action
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
	`fields` text NOT NULL,
	`slug` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`createdBy` text NOT NULL,
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
CREATE UNIQUE INDEX `cms_entry_collection_slug_unique` ON `cms_entry` (`collection`,`slug`);--> statement-breakpoint
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
CREATE INDEX `cms_media_bucket_key_idx` ON `cms_media` (`bucketKey`);--> statement-breakpoint
CREATE INDEX `cms_media_uploaded_by_idx` ON `cms_media` (`uploadedBy`);