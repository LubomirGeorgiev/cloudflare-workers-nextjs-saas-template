CREATE TABLE `credit_transaction` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text NOT NULL,
	`amount` integer NOT NULL,
	`remainingAmount` integer DEFAULT 0 NOT NULL,
	`type` text NOT NULL,
	`description` text(255) NOT NULL,
	`expirationDate` integer,
	`expirationDateProcessedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `credit_transaction_user_id_idx` ON `credit_transaction` (`userId`);--> statement-breakpoint
CREATE INDEX `credit_transaction_type_idx` ON `credit_transaction` (`type`);--> statement-breakpoint
CREATE INDEX `credit_transaction_created_at_idx` ON `credit_transaction` (`createdAt`);--> statement-breakpoint
CREATE INDEX `credit_transaction_expiration_date_idx` ON `credit_transaction` (`expirationDate`);--> statement-breakpoint
CREATE TABLE `purchased_item` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text NOT NULL,
	`itemType` text NOT NULL,
	`itemId` text NOT NULL,
	`purchasedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchased_item_user_id_idx` ON `purchased_item` (`userId`);--> statement-breakpoint
CREATE INDEX `purchased_item_type_idx` ON `purchased_item` (`itemType`);--> statement-breakpoint
CREATE INDEX `purchased_item_user_item_idx` ON `purchased_item` (`userId`,`itemType`,`itemId`);--> statement-breakpoint
ALTER TABLE `user` ADD `currentCredits` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `user` ADD `lastCreditRefreshAt` integer;