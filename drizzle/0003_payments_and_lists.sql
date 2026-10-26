CREATE TABLE `expense_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`sort` smallint NOT NULL DEFAULT 100,
	CONSTRAINT `expense_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_categories_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`vendor` varchar(200) NOT NULL,
	`category` varchar(80) NOT NULL,
	`description` varchar(500) NOT NULL DEFAULT '',
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`billing_cycle` enum('weekly','monthly','quarterly','yearly','once') NOT NULL DEFAULT 'monthly',
	`next_due_date` date NOT NULL,
	`status` enum('active','paused','cancelled','completed') NOT NULL DEFAULT 'active',
	`reminder_days` smallint NOT NULL DEFAULT 3,
	`paid_from` varchar(120) NOT NULL DEFAULT '',
	`responsible_user_id` varchar(36),
	`country_code` varchar(8),
	`notes` text,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `sub_amount_chk` CHECK(`subscriptions`.`amount_minor` > 0),
	CONSTRAINT `sub_rate_chk` CHECK(`subscriptions`.`fx_rate_to_base` > 0),
	CONSTRAINT `sub_currency_chk` CHECK(`subscriptions`.`currency` regexp '^[A-Z]{3}$'),
	CONSTRAINT `sub_reminder_chk` CHECK(`subscriptions`.`reminder_days` between 0 and 90)
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD `country_code` varchar(8);--> statement-breakpoint
ALTER TABLE `expenses` ADD `subscription_id` varchar(36);--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_responsible_user_id_users_id_fk` FOREIGN KEY (`responsible_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sub_due_idx` ON `subscriptions` (`status`,`next_due_date`);--> statement-breakpoint
CREATE INDEX `sub_created_by_idx` ON `subscriptions` (`created_by`);--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_subscription_id_subscriptions_id_fk` FOREIGN KEY (`subscription_id`) REFERENCES `subscriptions`(`id`) ON DELETE set null ON UPDATE no action;