CREATE TABLE `income_shares` (
	`income_entry_id` varchar(36) NOT NULL,
	`representative_id` varchar(36) NOT NULL,
	`share_rate` decimal(5,4) NOT NULL,
	CONSTRAINT `income_shares_income_entry_id_representative_id_pk` PRIMARY KEY(`income_entry_id`,`representative_id`),
	CONSTRAINT `income_share_rate_chk` CHECK(`income_shares`.`share_rate` > 0 and `income_shares`.`share_rate` <= 1)
);
--> statement-breakpoint
CREATE TABLE `project_partners` (
	`project_id` varchar(36) NOT NULL,
	`representative_id` varchar(36) NOT NULL,
	`share_rate` decimal(5,4) NOT NULL,
	CONSTRAINT `project_partners_project_id_representative_id_pk` PRIMARY KEY(`project_id`,`representative_id`),
	CONSTRAINT `project_partner_rate_chk` CHECK(`project_partners`.`share_rate` > 0 and `project_partners`.`share_rate` <= 1)
);
--> statement-breakpoint
ALTER TABLE `files` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner') NOT NULL;--> statement-breakpoint
ALTER TABLE `preset_permissions` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner') NOT NULL;--> statement-breakpoint
ALTER TABLE `user_permissions` MODIFY COLUMN `module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit','partner') NOT NULL;--> statement-breakpoint
ALTER TABLE `income_shares` ADD CONSTRAINT `income_shares_income_entry_id_income_entries_id_fk` FOREIGN KEY (`income_entry_id`) REFERENCES `income_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_shares` ADD CONSTRAINT `income_shares_representative_id_representatives_id_fk` FOREIGN KEY (`representative_id`) REFERENCES `representatives`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_partners` ADD CONSTRAINT `project_partners_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `project_partners` ADD CONSTRAINT `project_partners_representative_id_representatives_id_fk` FOREIGN KEY (`representative_id`) REFERENCES `representatives`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `income_share_rep_idx` ON `income_shares` (`representative_id`);--> statement-breakpoint
CREATE INDEX `project_partner_rep_idx` ON `project_partners` (`representative_id`);--> statement-breakpoint
-- "Partner": signs in and sees only their own share, payouts and balance (the "My earnings" page).
-- No access to anything else: not the ledger, streams, other partners or the team. Two-factor is required.
INSERT INTO `role_presets` (`id`, `name`, `description`, `sort`) VALUES
  ('partner', 'Partner', 'A business partner: sees only their own share of the projects they are on, their payouts and what they are owed. Nothing else in the portal. Two-factor required.', 36);
--> statement-breakpoint
INSERT INTO `preset_permissions` (`preset_id`, `module`, `can_view`, `can_create`, `can_edit`, `can_delete`, `can_export`, `scope`) VALUES
  ('partner', 'partner', 1, 0, 0, 0, 0, 'own');