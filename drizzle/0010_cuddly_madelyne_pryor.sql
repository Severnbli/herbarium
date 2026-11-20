CREATE TABLE `__new_event` (
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
	`sort_date` text,
	`recurrence_rule` text,
	`occasion_type` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "event_coordinates" CHECK(("__new_event"."lat" IS NULL AND "__new_event"."lon" IS NULL) OR ("__new_event"."lat" IS NOT NULL AND "__new_event"."lon" IS NOT NULL AND "__new_event"."lat" BETWEEN -90 AND 90 AND "__new_event"."lon" BETWEEN -180 AND 180)),
	CONSTRAINT "event_dates" CHECK(("__new_event"."date_mode" = 'undated' AND "__new_event"."kind" = 'plan' AND "__new_event"."precision" = 'day' AND "__new_event"."sort_date" IS NULL AND "__new_event"."start_date" IS NULL AND "__new_event"."end_date" IS NULL AND "__new_event"."starts_at" IS NULL AND "__new_event"."ends_at" IS NULL AND "__new_event"."time_zone" IS NULL) OR ("__new_event"."sort_date" IS NOT NULL AND (("__new_event"."date_mode" = 'date' AND "__new_event"."start_date" IS NOT NULL AND "__new_event"."starts_at" IS NULL AND "__new_event"."ends_at" IS NULL AND "__new_event"."time_zone" IS NULL) OR ("__new_event"."date_mode" = 'timed' AND "__new_event"."precision" = 'day' AND "__new_event"."starts_at" IS NOT NULL AND "__new_event"."time_zone" IS NOT NULL AND "__new_event"."start_date" IS NULL AND "__new_event"."end_date" IS NULL))))
);
--> statement-breakpoint
INSERT INTO `__new_event`("id", "kind", "title", "notes", "place", "lat", "lon", "category", "date_mode", "precision", "start_date", "end_date", "starts_at", "ends_at", "time_zone", "sort_date", "recurrence_rule", "occasion_type", "created_by", "created_at", "updated_at") SELECT "id", "kind", "title", "notes", "place", "lat", "lon", "category", "date_mode", "precision", "start_date", "end_date", "starts_at", "ends_at", "time_zone", "sort_date", "recurrence_rule", "occasion_type", "created_by", "created_at", "updated_at" FROM `event`;--> statement-breakpoint
DROP TABLE `event`;--> statement-breakpoint
ALTER TABLE `__new_event` RENAME TO `event`;--> statement-breakpoint
CREATE INDEX `event_sort_idx` ON `event` (`sort_date`,`id`);--> statement-breakpoint
CREATE INDEX `event_kind_sort_idx` ON `event` (`kind`,`sort_date`);--> statement-breakpoint
CREATE INDEX `event_month_day_sort_idx` ON `event` (substr("sort_date", 6),`sort_date`,`id`);--> statement-breakpoint
-- Check references inside the transaction before the new table replaces the original permanently.
CREATE TEMP TABLE __event_migration_check (violations INTEGER CHECK (violations = 0));
--> statement-breakpoint
INSERT INTO __event_migration_check SELECT count(*) FROM pragma_foreign_key_check;
--> statement-breakpoint
DROP TABLE __event_migration_check;
