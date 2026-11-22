CREATE TABLE `event_place` (
	`event_id` text NOT NULL,
	`position` integer NOT NULL,
	`place` text NOT NULL,
	`lat` real,
	`lon` real,
	PRIMARY KEY(`event_id`, `position`),
	FOREIGN KEY (`event_id`) REFERENCES `event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_place` (
	`id` text PRIMARY KEY NOT NULL,
	`place` text NOT NULL,
	`lat` real NOT NULL,
	`lon` real NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
