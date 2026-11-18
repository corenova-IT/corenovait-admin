CREATE TABLE `stream_partner_countries` (
	`user_id` varchar(36) NOT NULL,
	`country_code` varchar(8) NOT NULL,
	`assigned_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stream_partner_countries_user_id_country_code_pk` PRIMARY KEY(`user_id`,`country_code`)
);
--> statement-breakpoint
CREATE TABLE `stream_partner_streams` (
	`stream_id` int NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`assigned_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `stream_partner_streams_stream_id` PRIMARY KEY(`stream_id`)
);
--> statement-breakpoint
ALTER TABLE `files` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner','stream_partner','employee') NOT NULL;--> statement-breakpoint
ALTER TABLE `preset_permissions` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner','stream_partner','employee') NOT NULL;--> statement-breakpoint
ALTER TABLE `user_permissions` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner','stream_partner','employee') NOT NULL;--> statement-breakpoint
ALTER TABLE `expenses` ADD `stream_id` int;--> statement-breakpoint
ALTER TABLE `expenses` ADD `archived_at` datetime(3);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `stream_id` int;--> statement-breakpoint
ALTER TABLE `tasks` ADD `stream_id` int;--> statement-breakpoint
ALTER TABLE `tasks` ADD `project_id` varchar(36);--> statement-breakpoint
ALTER TABLE `tasks` ADD `archived_at` datetime(3);--> statement-breakpoint
ALTER TABLE `stream_partner_countries` ADD CONSTRAINT `stream_partner_countries_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stream_partner_countries` ADD CONSTRAINT `stream_partner_countries_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stream_partner_countries` ADD CONSTRAINT `stream_partner_countries_assigned_by_users_id_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stream_partner_streams` ADD CONSTRAINT `stream_partner_streams_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stream_partner_streams` ADD CONSTRAINT `stream_partner_streams_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `stream_partner_streams` ADD CONSTRAINT `stream_partner_streams_assigned_by_users_id_fk` FOREIGN KEY (`assigned_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sps_user_idx` ON `stream_partner_streams` (`user_id`);--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `expense_stream_country_idx` ON `expenses` (`stream_id`,`country_code`);--> statement-breakpoint
CREATE INDEX `sub_stream_country_idx` ON `subscriptions` (`stream_id`,`country_code`);--> statement-breakpoint
CREATE INDEX `task_stream_idx` ON `tasks` (`stream_id`);--> statement-breakpoint
-- "Stream partner": runs one or more revenue streams in assigned countries. Sees only the data that matches an
-- assigned stream AND an assigned country (the rows are decided by lib/dal/scope.ts, not by this matrix).
-- Holds NO existing module, so every older page and query refuses them. Two-factor is required.
INSERT INTO `role_presets` (`id`, `name`, `description`, `sort`) VALUES
  ('stream_partner', 'Stream partner', 'Runs one or more revenue streams in assigned countries and sees only the data that matches both. Cannot enter income or change shares. Two-factor required.', 37),
  ('employee', 'Employee', 'Works for one stream partner on assigned projects: own tasks, own hours and chat only. Never sees money.', 38);
--> statement-breakpoint
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('stream_partner', 'stream_partner', 1, 1, 1, 0, 0, 'own'),
  ('employee', 'employee', 1, 1, 1, 0, 0, 'own');
