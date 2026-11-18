CREATE TABLE `employee_assignments` (
	`employee_user_id` varchar(36) NOT NULL,
	`partner_user_id` varchar(36) NOT NULL,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `employee_assignments_employee_user_id` PRIMARY KEY(`employee_user_id`)
);
--> statement-breakpoint
CREATE TABLE `employee_pay_plans` (
	`id` varchar(36) NOT NULL,
	`employee_user_id` varchar(36) NOT NULL,
	`kind` enum('monthly','project') NOT NULL,
	`stream_id` int NOT NULL,
	`country_code` varchar(8) NOT NULL,
	`project_id` varchar(36),
	`start_month` varchar(7),
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `employee_pay_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `pay_plan_amount_chk` CHECK(`employee_pay_plans`.`amount_minor` > 0),
	CONSTRAINT `pay_plan_rate_chk` CHECK(`employee_pay_plans`.`fx_rate_to_base` > 0),
	CONSTRAINT `pay_plan_currency_chk` CHECK(`employee_pay_plans`.`currency` regexp '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE `employee_pay_records` (
	`id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`employee_user_id` varchar(36) NOT NULL,
	`period` varchar(10) NOT NULL,
	`stream_id` int NOT NULL,
	`country_code` varchar(8) NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`status` enum('due','paid') NOT NULL DEFAULT 'due',
	`paid_date` date,
	`cost_date` date,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `employee_pay_records_id` PRIMARY KEY(`id`),
	CONSTRAINT `pay_record_plan_period_uq` UNIQUE(`plan_id`,`period`)
);
--> statement-breakpoint
CREATE TABLE `project_members` (
	`project_id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`added_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `project_members_project_id_user_id_pk` PRIMARY KEY(`project_id`,`user_id`)
);
--> statement-breakpoint
ALTER TABLE `projects` ADD `team_visible` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `employee_assignments` ADD CONSTRAINT `employee_assignments_employee_user_id_users_id_fk` FOREIGN KEY (`employee_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_assignments` ADD CONSTRAINT `employee_assignments_partner_user_id_users_id_fk` FOREIGN KEY (`partner_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_assignments` ADD CONSTRAINT `employee_assignments_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_plans` ADD CONSTRAINT `employee_pay_plans_employee_user_id_users_id_fk` FOREIGN KEY (`employee_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_plans` ADD CONSTRAINT `employee_pay_plans_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_plans` ADD CONSTRAINT `employee_pay_plans_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_plans` ADD CONSTRAINT `employee_pay_plans_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_plans` ADD CONSTRAINT `employee_pay_plans_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_records` ADD CONSTRAINT `employee_pay_records_plan_id_employee_pay_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `employee_pay_plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_records` ADD CONSTRAINT `employee_pay_records_employee_user_id_users_id_fk` FOREIGN KEY (`employee_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_records` ADD CONSTRAINT `employee_pay_records_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_pay_records` ADD CONSTRAINT `employee_pay_records_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_members` ADD CONSTRAINT `project_members_added_by_users_id_fk` FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `emp_assign_partner_idx` ON `employee_assignments` (`partner_user_id`);--> statement-breakpoint
CREATE INDEX `pay_plan_employee_idx` ON `employee_pay_plans` (`employee_user_id`);--> statement-breakpoint
CREATE INDEX `pay_plan_stream_idx` ON `employee_pay_plans` (`stream_id`,`country_code`);--> statement-breakpoint
CREATE INDEX `pay_record_cost_idx` ON `employee_pay_records` (`stream_id`,`country_code`,`cost_date`);--> statement-breakpoint
CREATE INDEX `pay_record_employee_idx` ON `employee_pay_records` (`employee_user_id`);--> statement-breakpoint
CREATE INDEX `project_member_user_idx` ON `project_members` (`user_id`);