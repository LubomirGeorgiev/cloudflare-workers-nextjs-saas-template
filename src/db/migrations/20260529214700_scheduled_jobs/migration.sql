CREATE TABLE `scheduled_job` (
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`updateCounter` integer DEFAULT 0,
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`dedupeKey` text NOT NULL,
	`payload` text NOT NULL,
	`runAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scheduled_job_run_at_idx` ON `scheduled_job` (`runAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduled_job_type_dedupe_key_unique` ON `scheduled_job` (`type`,`dedupeKey`);