CREATE TABLE `event_exceptions` (
	`event_id` varchar(36) NOT NULL,
	`occurrence_date` date NOT NULL,
	CONSTRAINT `event_exceptions_event_id_occurrence_date_pk` PRIMARY KEY(`event_id`,`occurrence_date`)
);
--> statement-breakpoint
ALTER TABLE `chat_messages` ADD `removed_by_admin` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence` enum('none','daily','weekly','monthly') DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `recurrence_until` date;--> statement-breakpoint
ALTER TABLE `event_exceptions` ADD CONSTRAINT `event_exceptions_event_id_events_id_fk` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `event_ends_idx` ON `events` (`ends_at`);--> statement-breakpoint
CREATE INDEX `event_recurrence_idx` ON `events` (`recurrence`,`recurrence_until`);--> statement-breakpoint
CREATE INDEX `expense_country_date_idx` ON `expenses` (`country_code`,`expense_date`);--> statement-breakpoint
CREATE INDEX `files_module_created_idx` ON `files` (`module`,`created_at`);--> statement-breakpoint
CREATE INDEX `income_country_date_idx` ON `income_entries` (`country_code`,`entry_date`);--> statement-breakpoint
CREATE INDEX `income_stream_date_idx` ON `income_entries` (`stream_id`,`entry_date`);--> statement-breakpoint
CREATE INDEX `task_status_due_idx` ON `tasks` (`status`,`due_date`);