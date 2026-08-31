PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_sightings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`species` text NOT NULL,
	`species_code` text NOT NULL,
	`date` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`location_name` text NOT NULL,
	`notes` text DEFAULT '',
	`user_id` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_sightings`("id", "species", "species_code", "date", "lat", "lng", "location_name", "notes", "user_id", "created_at") SELECT "id", "species", "species_code", "date", "lat", "lng", "location_name", "notes", "user_id", "created_at" FROM `sightings`;--> statement-breakpoint
DROP TABLE `sightings`;--> statement-breakpoint
ALTER TABLE `__new_sightings` RENAME TO `sightings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;