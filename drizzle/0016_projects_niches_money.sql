CREATE TABLE `income_deductions` (
	`id` varchar(36) NOT NULL,
	`income_entry_id` varchar(36) NOT NULL,
	`kind` enum('platform','withdrawal','vat_transfer','other') NOT NULL,
	`label` varchar(80) NOT NULL DEFAULT '',
	`amount_minor` bigint NOT NULL,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `income_deductions_id` PRIMARY KEY(`id`),
	CONSTRAINT `income_deduction_amount_chk` CHECK(`income_deductions`.`amount_minor` > 0)
);
--> statement-breakpoint
CREATE TABLE `niches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`sort` smallint NOT NULL DEFAULT 100,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `niches_id` PRIMARY KEY(`id`),
	CONSTRAINT `niches_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `sub_niches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`niche_id` int NOT NULL,
	`name` varchar(80) NOT NULL,
	`sort` smallint NOT NULL DEFAULT 100,
	`is_custom` boolean NOT NULL DEFAULT false,
	`active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	CONSTRAINT `sub_niches_id` PRIMARY KEY(`id`),
	CONSTRAINT `sub_niches_uq` UNIQUE(`niche_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `expenses` ADD `project_id` varchar(36);--> statement-breakpoint
ALTER TABLE `income_entries` ADD `deductions_minor` bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `income_entries` ADD `net_base_minor` bigint GENERATED ALWAYS AS (round((`amount_minor` - `deductions_minor`) * `fx_rate_to_base`)) STORED;--> statement-breakpoint
ALTER TABLE `projects` ADD `niche_id` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `sub_niche_id` int;--> statement-breakpoint
ALTER TABLE `projects` ADD `lead_user_id` varchar(36);--> statement-breakpoint
ALTER TABLE `income_deductions` ADD CONSTRAINT `income_deductions_income_entry_id_income_entries_id_fk` FOREIGN KEY (`income_entry_id`) REFERENCES `income_entries`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_deductions` ADD CONSTRAINT `income_deductions_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sub_niches` ADD CONSTRAINT `sub_niches_niche_id_niches_id_fk` FOREIGN KEY (`niche_id`) REFERENCES `niches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sub_niches` ADD CONSTRAINT `sub_niches_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `income_deduction_entry_idx` ON `income_deductions` (`income_entry_id`);--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_deductions_chk` CHECK (`income_entries`.`deductions_minor` >= 0 and `income_entries`.`deductions_minor` <= `income_entries`.`amount_minor`);--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_niche_id_niches_id_fk` FOREIGN KEY (`niche_id`) REFERENCES `niches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_sub_niche_id_sub_niches_id_fk` FOREIGN KEY (`sub_niche_id`) REFERENCES `sub_niches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `projects` ADD CONSTRAINT `projects_lead_user_id_users_id_fk` FOREIGN KEY (`lead_user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `expense_project_idx` ON `expenses` (`project_id`);--> statement-breakpoint
-- The role formerly shown as "Stream partner" is now shown as "Partner" (the permission ids stay the same).
UPDATE `role_presets` SET `name` = 'Partner', `description` = 'Runs one or more revenue streams in assigned countries and sees only the data that matches both. Cannot enter income or change shares. Two-factor required.' WHERE `id` = 'stream_partner';
--> statement-breakpoint
-- The older revenue-share role keeps its id, permissions and sort order; only its on-screen name changes, so the two roles are told apart.
UPDATE `role_presets` SET `name` = 'Revenue-share partner' WHERE `id` = 'partner';
--> statement-breakpoint
UPDATE `role_presets` SET `description` = 'Works for one partner on assigned projects: own tasks, own hours and chat only. Never sees money.' WHERE `id` = 'employee';
--> statement-breakpoint
-- Kinds of work. Admins can edit these lists in Settings, and anyone adding a project can add their own sub-category.
INSERT INTO `niches` (`name`, `sort`) VALUES ('Motion graphics', 10), ('Web development', 20), ('App development', 30), ('3D', 40);
--> statement-breakpoint
INSERT INTO `sub_niches` (`niche_id`, `name`, `sort`, `is_custom`)
SELECT n.id, v.name, v.sort, 0 FROM `niches` n JOIN (
  SELECT 'Motion graphics' AS niche, 'Explainer video' AS name, 10 AS sort UNION ALL
  SELECT 'Motion graphics', 'Logo animation', 20 UNION ALL
  SELECT 'Motion graphics', 'Social media video', 30 UNION ALL
  SELECT 'Motion graphics', 'Product video', 40 UNION ALL
  SELECT 'Motion graphics', 'Other', 900 UNION ALL
  SELECT 'Web development', 'WordPress', 10 UNION ALL
  SELECT 'Web development', 'Shopify', 20 UNION ALL
  SELECT 'Web development', 'Wix', 30 UNION ALL
  SELECT 'Web development', 'Square', 40 UNION ALL
  SELECT 'Web development', 'Other', 900 UNION ALL
  SELECT 'App development', 'CRM', 10 UNION ALL
  SELECT 'App development', 'SaaS', 20 UNION ALL
  SELECT 'App development', 'Mobile app', 30 UNION ALL
  SELECT 'App development', 'Other', 900 UNION ALL
  SELECT '3D', 'Product render', 10 UNION ALL
  SELECT '3D', 'Animation', 20 UNION ALL
  SELECT '3D', 'Modelling', 30 UNION ALL
  SELECT '3D', 'Architecture', 40 UNION ALL
  SELECT '3D', 'Other', 900
) v ON v.niche = n.name;
