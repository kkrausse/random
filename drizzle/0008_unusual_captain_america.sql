PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_photo_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` integer,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	`deleted_at` text,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `photo_comments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_photo_comments`("id", "photo_id", "user_id", "parent_id", "body", "created_at", "updated_at", "deleted_at") SELECT "id", "photo_id", "user_id", "parent_id", "body", "created_at", "updated_at", NULL FROM `photo_comments`;--> statement-breakpoint
DROP TABLE `photo_comments`;--> statement-breakpoint
ALTER TABLE `__new_photo_comments` RENAME TO `photo_comments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `photo_comments_photo_id_created_at_idx` ON `photo_comments` (`photo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `photo_comments_parent_id_created_at_idx` ON `photo_comments` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `photo_comments_user_id_idx` ON `photo_comments` (`user_id`);
