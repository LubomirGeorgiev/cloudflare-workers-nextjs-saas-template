CREATE TABLE `api_key` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`teamId` text,
	`name` text(255) NOT NULL,
	`keyHash` text(64) NOT NULL,
	`keyPrefix` text(32) NOT NULL,
	`last4` text(8) NOT NULL,
	`scopes` text NOT NULL,
	`expiresAt` integer,
	`revokedAt` integer,
	`lastUsedAt` integer,
	CONSTRAINT `fk_api_key_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_api_key_teamId_team_id_fk` FOREIGN KEY (`teamId`) REFERENCES `team`(`id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_app` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`clientId` text NOT NULL,
	`ownerUserId` text,
	`ownerTeamId` text,
	`name` text,
	`logoUri` text,
	`redirectUris` text,
	`tokenEndpointAuthMethod` text,
	`secretHash` text,
	`registrationSource` text,
	`verifiedAt` integer,
	`lastRenewedAt` integer,
	CONSTRAINT `fk_oauth_app_ownerUserId_user_id_fk` FOREIGN KEY (`ownerUserId`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_oauth_app_ownerTeamId_team_id_fk` FOREIGN KEY (`ownerTeamId`) REFERENCES `team`(`id`)
);
--> statement-breakpoint
ALTER TABLE `user` ADD `lastActiveAt` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `api_key_key_hash_unique` ON `api_key` (`keyHash`);--> statement-breakpoint
CREATE INDEX `api_key_user_id_idx` ON `api_key` (`userId`);--> statement-breakpoint
CREATE INDEX `api_key_team_id_idx` ON `api_key` (`teamId`);--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_app_client_id_unique` ON `oauth_app` (`clientId`);--> statement-breakpoint
CREATE INDEX `oauth_app_verified_at_idx` ON `oauth_app` (`verifiedAt`);--> statement-breakpoint
CREATE INDEX `oauth_app_source_verified_updated_at_idx` ON `oauth_app` (`registrationSource`,`verifiedAt`,`updatedAt`);