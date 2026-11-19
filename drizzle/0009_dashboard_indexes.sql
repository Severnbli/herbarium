CREATE INDEX `event_month_day_sort_idx` ON `event` (substr(`sort_date`, 6), `sort_date`, `id`);--> statement-breakpoint
CREATE INDEX `memory_created_idx` ON `memory` (`created_at`,`id`);
