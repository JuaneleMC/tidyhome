CREATE TABLE `chore_catalog` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`frequency` text NOT NULL,
	`default_assignee_id` integer NOT NULL,
	`icon` text DEFAULT '🧹',
	`category` text DEFAULT 'Hogar',
	`day_of_week` integer DEFAULT 1,
	`created_at` text,
	FOREIGN KEY (`default_assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chore_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chore_id` integer NOT NULL,
	`target_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`assigned_to` integer NOT NULL,
	`executed_by` integer,
	`execution_date` text,
	`notes` text,
	`created_at` text,
	FOREIGN KEY (`chore_id`) REFERENCES `chore_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`executed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`avatar` text DEFAULT '👤',
	`color` text DEFAULT '#6366f1',
	`created_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);