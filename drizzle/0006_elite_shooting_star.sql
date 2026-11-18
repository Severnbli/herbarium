CREATE TABLE `event_reminder` (
	`event_id` text NOT NULL,
	`minutes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	PRIMARY KEY(`event_id`, `minutes`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reminder_delivery` (
	`event_id` text NOT NULL,
	`user_id` text NOT NULL,
	`occurrence` text NOT NULL,
	`minutes` integer NOT NULL,
	`due_at` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	PRIMARY KEY(`event_id`, `user_id`, `occurrence`, `minutes`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `reminder_delivery_due_idx` ON `reminder_delivery` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `reminder_delivery_user_idx` ON `reminder_delivery` (`user_id`);--> statement-breakpoint
CREATE TABLE `reminder_preference` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`enabled` integer NOT NULL,
	`time_zone` text NOT NULL,
	`locale` text NOT NULL,
	`changed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
