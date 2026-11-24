ALTER TABLE `event` ADD `saved_place_id` text REFERENCES `saved_place`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `event_place` ADD `saved_place_id` text REFERENCES `saved_place`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `saved_place_migration_lookup_idx` ON `saved_place` (`place`, `lat`, `lon`);
--> statement-breakpoint
UPDATE `event` AS target
SET `saved_place_id` = (
	SELECT CASE WHEN count(*) = 1 THEN min(saved.id) END
	FROM `saved_place` AS saved
	WHERE saved.place = target.place AND saved.lat = target.lat AND saved.lon = target.lon
)
WHERE target.lat IS NOT NULL;
--> statement-breakpoint
UPDATE `event_place` AS target
SET `saved_place_id` = (
	SELECT CASE WHEN count(*) = 1 THEN min(saved.id) END
	FROM `saved_place` AS saved
	WHERE saved.place = target.place AND saved.lat = target.lat AND saved.lon = target.lon
)
WHERE target.lat IS NOT NULL;
--> statement-breakpoint
DROP INDEX `saved_place_migration_lookup_idx`;
--> statement-breakpoint
CREATE INDEX `event_saved_place_idx` ON `event` (`saved_place_id`);
--> statement-breakpoint
CREATE INDEX `event_place_saved_place_idx` ON `event_place` (`saved_place_id`);
