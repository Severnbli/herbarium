CREATE TABLE `event` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`place` text DEFAULT '' NOT NULL,
	`lat` real,
	`lon` real,
	`category` text DEFAULT 'none' NOT NULL,
	`date_mode` text NOT NULL,
	`precision` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`starts_at` integer,
	`ends_at` integer,
	`time_zone` text,
	`sort_date` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_coordinates" CHECK(("event"."lat" IS NULL AND "event"."lon" IS NULL) OR ("event"."lat" IS NOT NULL AND "event"."lon" IS NOT NULL AND "event"."lat" BETWEEN -90 AND 90 AND "event"."lon" BETWEEN -180 AND 180)),
	CONSTRAINT "event_dates" CHECK(("event"."date_mode" = 'date' AND "event"."start_date" IS NOT NULL AND "event"."starts_at" IS NULL AND "event"."ends_at" IS NULL AND "event"."time_zone" IS NULL) OR ("event"."date_mode" = 'timed' AND "event"."precision" = 'day' AND "event"."starts_at" IS NOT NULL AND "event"."time_zone" IS NOT NULL AND "event"."start_date" IS NULL AND "event"."end_date" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `event_sort_idx` ON `event` (`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `event_kind_sort_idx` ON `event` (`kind`,`sort_date`);