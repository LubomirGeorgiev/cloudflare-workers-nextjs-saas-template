CREATE TABLE `banned_email` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`kind` text(20) NOT NULL,
	`value` text(255) NOT NULL,
	`pattern` text(255) NOT NULL,
	`reason` text(1000),
	`createdByUserId` text(255)
);
--> statement-breakpoint
CREATE TABLE `user_ban_event` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`action` text(20) NOT NULL,
	`internalReason` text(1000) NOT NULL,
	`externalReason` text(1000),
	`actorUserId` text(255),
	`noticeQueuedAt` integer,
	`cancelledSubscriptionCount` integer,
	CONSTRAINT `fk_user_ban_event_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `bannedAt` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `banned_email_kind_value_unique` ON `banned_email` (`kind`,`value`);--> statement-breakpoint
CREATE INDEX `banned_email_created_at_idx` ON `banned_email` (`createdAt`);--> statement-breakpoint
CREATE INDEX `team_invitation_invited_by_idx` ON `team_invitation` (`invitedBy`);--> statement-breakpoint
CREATE INDEX `user_ban_event_user_created_at_idx` ON `user_ban_event` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `user_banned_at_idx` ON `user` (`bannedAt`);