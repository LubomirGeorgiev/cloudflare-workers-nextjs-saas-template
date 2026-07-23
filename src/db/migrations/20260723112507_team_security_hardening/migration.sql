CREATE TABLE `team_trial_reservation` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer,
	`id` text PRIMARY KEY,
	`userId` text NOT NULL,
	`teamId` text NOT NULL,
	`setupIntentId` text NOT NULL,
	`planId` text NOT NULL,
	`interval` text NOT NULL,
	`customerId` text NOT NULL,
	`paymentMethodId` text NOT NULL,
	`priceId` text NOT NULL,
	`trialDays` integer NOT NULL,
	`stripeSubscriptionId` text,
	`orphanedSubscriptionId` text,
	`lastError` text,
	`lastRecoveryAt` integer,
	CONSTRAINT `fk_team_trial_reservation_userId_user_id_fk` FOREIGN KEY (`userId`) REFERENCES `user`(`id`),
	CONSTRAINT `fk_team_trial_reservation_teamId_team_id_fk` FOREIGN KEY (`teamId`) REFERENCES `team`(`id`)
);
--> statement-breakpoint
DROP INDEX IF EXISTS `team_invitation_team_email_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_membership_unique_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `team_role_name_unique_idx`;--> statement-breakpoint
-- Invitation tokens are now stored hashed; pending rows hold unusable plaintext bearer
-- tokens, so purge them (invites must be resent). Also clears legacy duplicate/mixed-case
-- pending rows before the partial unique index below is created.
DELETE FROM `team_invitation` WHERE `acceptedAt` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `team_invitation_team_email_pending_unique` ON `team_invitation` (`teamId`,`email`) WHERE "team_invitation"."acceptedAt" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `team_membership_team_user_unique` ON `team_membership` (`teamId`,`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_role_team_name_unique` ON `team_role` (`teamId`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_trial_reservation_user_id_unique` ON `team_trial_reservation` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_trial_reservation_team_id_unique` ON `team_trial_reservation` (`teamId`);