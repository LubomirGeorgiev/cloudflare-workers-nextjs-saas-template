ALTER TABLE `credit_transaction` ADD `updateCounter` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `credit_transaction` ADD `paymentIntentId` text(255);--> statement-breakpoint
CREATE INDEX `credit_transaction_payment_intent_id_idx` ON `credit_transaction` (`paymentIntentId`);--> statement-breakpoint
ALTER TABLE `passkey_credential` ADD `updateCounter` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `purchased_item` ADD `updateCounter` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `user` ADD `updateCounter` integer DEFAULT 0;