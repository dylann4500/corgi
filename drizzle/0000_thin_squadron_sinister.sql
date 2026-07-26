CREATE TABLE `match_queue` (
	`player_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rating` integer NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`room_id` text
);
--> statement-breakpoint
CREATE INDEX `match_queue_waiting_idx` ON `match_queue` (`room_id`,`joined_at`);--> statement-breakpoint
CREATE INDEX `match_queue_seen_idx` ON `match_queue` (`last_seen`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`rating` integer DEFAULT 1200 NOT NULL,
	`wins` integer DEFAULT 0 NOT NULL,
	`losses` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `players_rating_idx` ON `players` (`rating`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`player1_id` text NOT NULL,
	`player2_id` text NOT NULL,
	`prompt_index` integer NOT NULL,
	`status` text DEFAULT 'matched' NOT NULL,
	`player1_ready` integer DEFAULT 0 NOT NULL,
	`player2_ready` integer DEFAULT 0 NOT NULL,
	`starts_at` integer,
	`player1_score` text,
	`player2_score` text,
	`rated` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_player1_idx` ON `rooms` (`player1_id`,`status`);--> statement-breakpoint
CREATE INDEX `rooms_player2_idx` ON `rooms` (`player2_id`,`status`);--> statement-breakpoint
CREATE INDEX `rooms_created_idx` ON `rooms` (`created_at`);--> statement-breakpoint
CREATE TABLE `signals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signals_recipient_idx` ON `signals` (`room_id`,`recipient_id`,`id`);--> statement-breakpoint
CREATE INDEX `signals_created_idx` ON `signals` (`created_at`);