ALTER TABLE `user` ADD `signUpIpAddress` text(100);--> statement-breakpoint
ALTER TABLE `user` ADD `googleAccountId` text(255);--> statement-breakpoint
ALTER TABLE `user` ADD `avatar` text(600);--> statement-breakpoint
CREATE INDEX `email_idx` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `google_account_id_idx` ON `user` (`googleAccountId`);--> statement-breakpoint
CREATE INDEX `role_idx` ON `user` (`role`);