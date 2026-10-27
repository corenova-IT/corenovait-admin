CREATE TABLE `chat_channels` (
	`id` varchar(36) NOT NULL,
	`kind` enum('channel','dm') NOT NULL DEFAULT 'channel',
	`name` varchar(60) NOT NULL DEFAULT '',
	`topic` varchar(200) NOT NULL DEFAULT '',
	`is_default` boolean NOT NULL DEFAULT false,
	`dm_key` varchar(80),
	`archived_at` datetime(3),
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `chat_channels_id` PRIMARY KEY(`id`),
	CONSTRAINT `chat_dm_uq` UNIQUE(`dm_key`)
);
--> statement-breakpoint
CREATE TABLE `chat_members` (
	`channel_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`last_read_at` datetime(3) NOT NULL,
	`typing_until` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `chat_members_channel_id_user_id_pk` PRIMARY KEY(`channel_id`,`user_id`)
);
--> statement-breakpoint
CREATE TABLE `chat_messages` (
	`id` varchar(36) NOT NULL,
	`channel_id` varchar(36) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`file_id` varchar(36),
	`edited_at` datetime(3),
	`deleted_at` datetime(3),
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `chat_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`type` enum('task_assigned','task_due','meeting_reminder','payment_due','chat_mention') NOT NULL,
	`title` varchar(200) NOT NULL,
	`body` varchar(500) NOT NULL DEFAULT '',
	`href` varchar(300) NOT NULL DEFAULT '',
	`dedupe_key` varchar(191) NOT NULL,
	`read_at` datetime(3),
	`emailed_at` datetime(3),
	`email_skipped` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `notif_dedupe_uq` UNIQUE(`dedupe_key`)
);
--> statement-breakpoint
CREATE TABLE `user_presence` (
	`user_id` varchar(36) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	CONSTRAINT `user_presence_user_id` PRIMARY KEY(`user_id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `notify_email` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_channels` ADD CONSTRAINT `chat_channels_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_channel_id_chat_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_members` ADD CONSTRAINT `chat_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_channel_id_chat_channels_id_fk` FOREIGN KEY (`channel_id`) REFERENCES `chat_channels`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `chat_messages` ADD CONSTRAINT `chat_messages_file_id_files_id_fk` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_presence` ADD CONSTRAINT `user_presence_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `chat_kind_idx` ON `chat_channels` (`kind`,`name`);--> statement-breakpoint
CREATE INDEX `chat_member_user_idx` ON `chat_members` (`user_id`);--> statement-breakpoint
CREATE INDEX `chat_msg_channel_idx` ON `chat_messages` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `chat_msg_updated_idx` ON `chat_messages` (`channel_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `notif_user_idx` ON `notifications` (`user_id`,`read_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `notif_email_idx` ON `notifications` (`emailed_at`,`email_skipped`);