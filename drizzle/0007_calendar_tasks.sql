CREATE TABLE `event_attendees` (
	`event_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT `event_attendees_event_id_user_id_pk` PRIMARY KEY(`event_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`type` enum('meeting','deadline','payment','other') NOT NULL DEFAULT 'meeting',
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`all_day` boolean NOT NULL DEFAULT false,
	`location` varchar(300) NOT NULL DEFAULT '',
	`video_url` varchar(500) NOT NULL DEFAULT '',
	`description` text,
	`reminder_minutes` smallint,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `events_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_times_chk` CHECK(`events`.`ends_at` >= `events`.`starts_at`),
	CONSTRAINT `event_reminder_chk` CHECK(`events`.`reminder_minutes` is null or `events`.`reminder_minutes` between 0 and 10080)
);
--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` varchar(36) NOT NULL,
	`task_id` varchar(36) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `task_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`status` enum('todo','in_progress','review','done') NOT NULL DEFAULT 'todo',
	`priority` enum('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
	`assignee_id` varchar(36),
	`due_date` date,
	`labels` json,
	`checklist` json,
	`completed_at` datetime(3),
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `event_attendees` ADD CONSTRAINT `event_attendees_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `event_attendees` ADD CONSTRAINT `event_attendees_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `events` ADD CONSTRAINT `events_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `task_comments` ADD CONSTRAINT `task_comments_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `attendee_user_idx` ON `event_attendees` (`user_id`);--> statement-breakpoint
CREATE INDEX `event_starts_idx` ON `events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `event_created_by_idx` ON `events` (`created_by`);--> statement-breakpoint
CREATE INDEX `comment_task_idx` ON `task_comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `task_assignee_idx` ON `tasks` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `task_due_idx` ON `tasks` (`due_date`);--> statement-breakpoint
CREATE INDEX `task_created_by_idx` ON `tasks` (`created_by`);