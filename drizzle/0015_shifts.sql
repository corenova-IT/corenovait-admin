CREATE TABLE `shifts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`clock_in_at` datetime(3) NOT NULL,
	`clock_out_at` datetime(3),
	`open_key` tinyint GENERATED ALWAYS AS (if(`clock_out_at` is null, 1, null)) STORED,
	`flagged_at` datetime(3),
	`corrected_by` varchar(36),
	`corrected_at` datetime(3),
	`correction_note` varchar(300),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `shifts_id` PRIMARY KEY(`id`),
	CONSTRAINT `shift_one_open_uq` UNIQUE(`user_id`,`open_key`),
	CONSTRAINT `shift_order_chk` CHECK(`shifts`.`clock_out_at` is null or `shifts`.`clock_out_at` > `shifts`.`clock_in_at`)
);
--> statement-breakpoint
ALTER TABLE `settings` ADD `shift_flag_hours` smallint DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shifts` ADD CONSTRAINT `shifts_corrected_by_users_id_fk` FOREIGN KEY (`corrected_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `shift_user_in_idx` ON `shifts` (`user_id`,`clock_in_at`);