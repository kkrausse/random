CREATE TABLE `photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sighting_id` integer NOT NULL,
	`filename` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sighting_id`) REFERENCES `sightings`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sightings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`species` text NOT NULL,
	`species_code` text NOT NULL,
	`date` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`location_name` text NOT NULL,
	`notes` text DEFAULT '',
	`user_id` text,
	`created_at` text NOT NULL
);
