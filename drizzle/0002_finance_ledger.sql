CREATE TABLE `rep_payouts` (
	`id` varchar(36) NOT NULL,
	`representative_id` varchar(36) NOT NULL,
	`paid_date` date NOT NULL,
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`reference` varchar(120) NOT NULL DEFAULT '',
	`notes` text,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `rep_payouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `payout_amount_chk` CHECK(`rep_payouts`.`amount_minor` > 0),
	CONSTRAINT `payout_rate_chk` CHECK(`rep_payouts`.`fx_rate_to_base` > 0),
	CONSTRAINT `payout_currency_chk` CHECK(`rep_payouts`.`currency` regexp '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE `income_entries` ADD `commission_rate` decimal(5,4);--> statement-breakpoint
ALTER TABLE `income_entries` ADD `invoice_file_id` varchar(36);--> statement-breakpoint
ALTER TABLE `rep_payouts` ADD CONSTRAINT `rep_payouts_representative_id_representatives_id_fk` FOREIGN KEY (`representative_id`) REFERENCES `representatives`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `rep_payouts` ADD CONSTRAINT `rep_payouts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `payout_rep_idx` ON `rep_payouts` (`representative_id`);--> statement-breakpoint
CREATE INDEX `payout_date_idx` ON `rep_payouts` (`paid_date`);--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_commission_chk` CHECK (`income_entries`.`commission_rate` is null or (`income_entries`.`commission_rate` >= 0 and `income_entries`.`commission_rate` <= 1));--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_invoice_file_id_files_id_fk` FOREIGN KEY (`invoice_file_id`) REFERENCES `files`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `expense_category_idx` ON `expenses` (`category`);--> statement-breakpoint
CREATE INDEX `income_status_idx` ON `income_entries` (`status`);