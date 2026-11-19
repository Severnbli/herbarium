CREATE TABLE `import_receipt` (
	`import_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`memory_id` text,
	`duplicate` integer NOT NULL,
	`organized` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`import_id`, `fingerprint`),
	FOREIGN KEY (`import_id`) REFERENCES `media_import`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_id`) REFERENCES `memory`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `import_receipt_memory_idx` ON `import_receipt` (`memory_id`);--> statement-breakpoint
CREATE TABLE `media_identity` (
	`id` integer PRIMARY KEY NOT NULL,
	`key` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_import` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_import_user_id_unique` ON `media_import` (`user_id`);--> statement-breakpoint
CREATE TABLE `memory_fingerprint` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `memory_fingerprint_digest_idx` ON `memory_fingerprint` (`digest`);