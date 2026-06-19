CREATE TABLE `passkey_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text NOT NULL,
	`credentialId` text(255) NOT NULL,
	`credentialPublicKey` text(255) NOT NULL,
	`counter` integer NOT NULL,
	`transports` text(255),
	`aaguid` text(255),
	`userAgent` text(255),
	`ipAddress` text(100),
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `passkey_credential_credentialId_unique` ON `passkey_credential` (`credentialId`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `passkey_credential` (`userId`);--> statement-breakpoint
CREATE INDEX `credential_id_idx` ON `passkey_credential` (`credentialId`);