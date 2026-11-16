CREATE TABLE `project_hidden_from` (
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`hidden_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `project_hidden_from_project_id_user_id_pk` PRIMARY KEY(`project_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(36) NOT NULL,
	`stream_id` int NOT NULL,
	`name` varchar(120) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`),
	CONSTRAINT `projects_stream_name_uq` UNIQUE(`stream_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `income_entries` ADD `project_id` varchar(36);--> statement-breakpoint
ALTER TABLE `users` ADD `is_owner` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `project_hidden_from` ADD CONSTRAINT `project_hidden_from_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_hidden_from` ADD CONSTRAINT `project_hidden_from_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_hidden_from` ADD CONSTRAINT `project_hidden_from_hidden_by_users_id_fk` FOREIGN KEY (`hidden_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `project_hidden_user_idx` ON `project_hidden_from` (`user_id`);--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `income_project_idx` ON `income_entries` (`project_id`);--> statement-breakpoint
-- A database that already has admins gets exactly one Owner: the oldest active admin.
-- (New databases: the first admin created by seed:admin / admin:sql is the Owner.)
UPDATE `users` SET `is_owner` = 1
WHERE `id` = (SELECT `id` FROM (SELECT `id` FROM `users` WHERE `preset_id` = 'admin' AND `status` = 'active' ORDER BY `created_at` ASC, `id` ASC LIMIT 1) AS `first_admin`);