ALTER TABLE `team` ADD `subscriptionPlanId` text(100) DEFAULT 'free';--> statement-breakpoint
ALTER TABLE `team` ADD `stripeCustomerId` text(255);--> statement-breakpoint
ALTER TABLE `team` ADD `stripeSubscriptionId` text(255);--> statement-breakpoint
ALTER TABLE `team` ADD `subscriptionStatus` text(50);--> statement-breakpoint
ALTER TABLE `team` ADD `subscriptionInterval` text(10);--> statement-breakpoint
ALTER TABLE `team` ADD `cancelAtPeriodEnd` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `team` ADD `trialUsedAt` integer;--> statement-breakpoint
ALTER TABLE `user` ADD `trialUsedAt` integer;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_type_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_expiration_date_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_dedupe_key_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `credit_transaction_payment_intent_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `purchased_item_user_id_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `purchased_item_type_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `purchased_item_user_item_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `team_stripe_customer_id_unique` ON `team` (`stripeCustomerId`);--> statement-breakpoint
CREATE UNIQUE INDEX `team_stripe_subscription_id_unique` ON `team` (`stripeSubscriptionId`);--> statement-breakpoint
DROP TABLE `credit_transaction`;--> statement-breakpoint
DROP TABLE `purchased_item`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `planId`;--> statement-breakpoint
ALTER TABLE `team` DROP COLUMN `creditBalance`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `currentCredits`;--> statement-breakpoint
ALTER TABLE `user` DROP COLUMN `lastCreditRefreshAt`;