ALTER TABLE `credit_transaction` ADD `dedupeKey` text(255);--> statement-breakpoint
CREATE UNIQUE INDEX `credit_transaction_dedupe_key_unique` ON `credit_transaction` (`dedupeKey`);