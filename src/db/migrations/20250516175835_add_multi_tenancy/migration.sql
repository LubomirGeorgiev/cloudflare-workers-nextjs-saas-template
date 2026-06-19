CREATE TABLE `team_invitation` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`email` text(255) NOT NULL,
	`roleId` text NOT NULL,
	`isSystemRole` integer DEFAULT 1 NOT NULL,
	`token` text(255) NOT NULL,
	`invitedBy` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`acceptedAt` integer,
	`acceptedBy` text,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invitedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`acceptedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_invitation_token_unique` ON `team_invitation` (`token`);--> statement-breakpoint
CREATE INDEX `team_invitation_team_id_idx` ON `team_invitation` (`teamId`);--> statement-breakpoint
CREATE INDEX `team_invitation_email_idx` ON `team_invitation` (`email`);--> statement-breakpoint
CREATE INDEX `team_invitation_token_idx` ON `team_invitation` (`token`);--> statement-breakpoint
CREATE TABLE `team_membership` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text NOT NULL,
	`roleId` text NOT NULL,
	`isSystemRole` integer DEFAULT 1 NOT NULL,
	`invitedBy` text,
	`invitedAt` integer,
	`joinedAt` integer,
	`expiresAt` integer,
	`isActive` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invitedBy`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `team_membership_team_id_idx` ON `team_membership` (`teamId`);--> statement-breakpoint
CREATE INDEX `team_membership_user_id_idx` ON `team_membership` (`userId`);--> statement-breakpoint
CREATE INDEX `team_membership_unique_idx` ON `team_membership` (`teamId`,`userId`);--> statement-breakpoint
CREATE TABLE `team_role` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text(255) NOT NULL,
	`description` text(1000),
	`permissions` text NOT NULL,
	`metadata` text(5000),
	`isEditable` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `team_role_team_id_idx` ON `team_role` (`teamId`);--> statement-breakpoint
CREATE INDEX `team_role_name_unique_idx` ON `team_role` (`teamId`,`name`);--> statement-breakpoint
CREATE TABLE `team` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`name` text(255) NOT NULL,
	`slug` text(255) NOT NULL,
	`description` text(1000),
	`avatarUrl` text(600),
	`settings` text(10000),
	`billingEmail` text(255),
	`planId` text(100),
	`planExpiresAt` integer,
	`creditBalance` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_slug_unique` ON `team` (`slug`);--> statement-breakpoint
CREATE INDEX `team_slug_idx` ON `team` (`slug`);