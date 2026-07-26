CREATE TABLE `turn_grants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`player_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `turn_grants_player_idx` ON `turn_grants` (`player_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `turn_grants_created_idx` ON `turn_grants` (`created_at`);