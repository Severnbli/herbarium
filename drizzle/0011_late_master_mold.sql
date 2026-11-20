CREATE TABLE `upload_receipt` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`destination` text NOT NULL,
	`memory_id` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_id`) REFERENCES `memory`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `upload_receipt_memory_idx` ON `upload_receipt` (`memory_id`);