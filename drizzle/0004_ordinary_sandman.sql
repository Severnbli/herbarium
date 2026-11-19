CREATE TABLE `media_file` (
	`id` text PRIMARY KEY NOT NULL,
	`memory_id` text NOT NULL,
	`variant` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`wrapped_key` blob NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_file_size" CHECK("media_file"."size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_file_variant_idx` ON `media_file` (`memory_id`,`variant`);--> statement-breakpoint
CREATE TABLE `memory` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text,
	`original_name` text NOT NULL,
	`alt_text` text NOT NULL,
	`caption` text NOT NULL,
	`capture_date` text,
	`sort_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `memory_sort_idx` ON `memory` (`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `memory_event_idx` ON `memory` (`event_id`,`sort_date`,`id`);