CREATE TABLE `photo_comment_likes` (
	`comment_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `photo_comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_comment_likes_comment_id_user_id_unique` ON `photo_comment_likes` (`comment_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `photo_comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`photo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`parent_id` integer,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `photo_comments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_comments_photo_id_created_at_idx` ON `photo_comments` (`photo_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `photo_comments_parent_id_created_at_idx` ON `photo_comments` (`parent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `photo_comments_user_id_idx` ON `photo_comments` (`user_id`);--> statement-breakpoint
CREATE TABLE `photo_likes` (
	`photo_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `photo_likes_photo_id_user_id_unique` ON `photo_likes` (`photo_id`,`user_id`);