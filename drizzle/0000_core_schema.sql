CREATE TABLE `audit_log` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`at` datetime(3) NOT NULL,
	`actor_id` varchar(36),
	`actor_email` varchar(254),
	`action` varchar(32) NOT NULL,
	`entity` varchar(64) NOT NULL,
	`entity_id` varchar(64),
	`summary` varchar(500),
	`before` json,
	`after` json,
	`ip` varchar(45),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`id` char(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`purpose` enum('invite','reset') NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `auth_tokens_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `countries` (
	`code` varchar(8) NOT NULL,
	`name` varchar(80) NOT NULL,
	`sort` smallint NOT NULL DEFAULT 100,
	CONSTRAINT `countries_code` PRIMARY KEY(`code`)
);
--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` varchar(36) NOT NULL,
	`expense_date` date NOT NULL,
	`category` varchar(80) NOT NULL,
	`vendor` varchar(200) NOT NULL DEFAULT '',
	`description` varchar(500) NOT NULL DEFAULT '',
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`receipt_file_id` varchar(36),
	`is_recurring` boolean NOT NULL DEFAULT false,
	`notes` text,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `expenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `expense_amount_chk` CHECK(`expenses`.`amount_minor` > 0),
	CONSTRAINT `expense_rate_chk` CHECK(`expenses`.`fx_rate_to_base` > 0),
	CONSTRAINT `expense_currency_chk` CHECK(`expenses`.`currency` regexp '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` varchar(36) NOT NULL,
	`module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit') NOT NULL,
	`entity_type` varchar(32),
	`entity_id` varchar(36),
	`original_name` varchar(200) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` int unsigned NOT NULL,
	`sha256` char(64) NOT NULL,
	`storage_key` char(32) NOT NULL,
	`uploaded_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `files_id` PRIMARY KEY(`id`),
	CONSTRAINT `files_storage_uq` UNIQUE(`storage_key`)
);
--> statement-breakpoint
CREATE TABLE `income_entries` (
	`id` varchar(36) NOT NULL,
	`entry_date` date NOT NULL,
	`stream_id` int NOT NULL,
	`country_code` varchar(8) NOT NULL,
	`client` varchar(200) NOT NULL DEFAULT '',
	`description` varchar(500) NOT NULL DEFAULT '',
	`amount_minor` bigint NOT NULL,
	`currency` char(3) NOT NULL,
	`fx_rate_to_base` decimal(18,8) NOT NULL DEFAULT '1',
	`amount_base_minor` bigint GENERATED ALWAYS AS (round(`amount_minor` * `fx_rate_to_base`)) STORED,
	`invoice_ref` varchar(80),
	`status` enum('pending','paid','overdue') NOT NULL DEFAULT 'pending',
	`representative_id` varchar(36),
	`notes` text,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `income_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `income_amount_chk` CHECK(`income_entries`.`amount_minor` > 0),
	CONSTRAINT `income_rate_chk` CHECK(`income_entries`.`fx_rate_to_base` > 0),
	CONSTRAINT `income_currency_chk` CHECK(`income_entries`.`currency` regexp '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE `preset_permissions` (
	`preset_id` varchar(32) NOT NULL,
	`module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit') NOT NULL,
	`can_view` boolean NOT NULL DEFAULT false,
	`can_create` boolean NOT NULL DEFAULT false,
	`can_edit` boolean NOT NULL DEFAULT false,
	`can_delete` boolean NOT NULL DEFAULT false,
	`can_export` boolean NOT NULL DEFAULT false,
	`scope` enum('own','assigned','all') NOT NULL DEFAULT 'own',
	CONSTRAINT `preset_permissions_preset_id_module_pk` PRIMARY KEY(`preset_id`,`module`)
);
--> statement-breakpoint
CREATE TABLE `recovery_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`code_hash` char(64) NOT NULL,
	`used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `recovery_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `representatives` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`email` varchar(254),
	`phone` varchar(40),
	`commission_rate` decimal(5,4) NOT NULL DEFAULT '0',
	`user_id` varchar(36),
	`active` boolean NOT NULL DEFAULT true,
	`created_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `representatives_id` PRIMARY KEY(`id`),
	CONSTRAINT `reps_rate_chk` CHECK(`representatives`.`commission_rate` >= 0 and `representatives`.`commission_rate` <= 1)
);
--> statement-breakpoint
CREATE TABLE `role_presets` (
	`id` varchar(32) NOT NULL,
	`name` varchar(60) NOT NULL,
	`description` varchar(300) NOT NULL DEFAULT '',
	`sort` smallint NOT NULL DEFAULT 100,
	CONSTRAINT `role_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(64) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`last_seen_at` datetime(3) NOT NULL,
	`expires_at` datetime(3) NOT NULL,
	`mfa_verified_at` datetime(3),
	`ip` varchar(45),
	`user_agent` varchar(255),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` tinyint NOT NULL DEFAULT 1,
	`company_name` varchar(120) NOT NULL DEFAULT 'CoreNovaIT',
	`base_currency` char(3) NOT NULL DEFAULT 'AUD',
	`timezone` varchar(64) NOT NULL DEFAULT 'Australia/Sydney',
	`updated_at` datetime(3),
	`updated_by` varchar(36),
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `streams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(80) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	`sort` smallint NOT NULL DEFAULT 100,
	CONSTRAINT `streams_id` PRIMARY KEY(`id`),
	CONSTRAINT `streams_name_uq` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `user_permissions` (
	`user_id` varchar(36) NOT NULL,
	`module` enum('home','finances','transactions','payments','streams','countries','representatives','marketing','calendar','tasks','chat','team','settings','audit') NOT NULL,
	`can_view` boolean NOT NULL DEFAULT false,
	`can_create` boolean NOT NULL DEFAULT false,
	`can_edit` boolean NOT NULL DEFAULT false,
	`can_delete` boolean NOT NULL DEFAULT false,
	`can_export` boolean NOT NULL DEFAULT false,
	`scope` enum('own','assigned','all') NOT NULL DEFAULT 'own',
	CONSTRAINT `user_permissions_user_id_module_pk` PRIMARY KEY(`user_id`,`module`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(254) NOT NULL,
	`full_name` varchar(120) NOT NULL DEFAULT '',
	`job_title` varchar(120) NOT NULL DEFAULT '',
	`preset_id` varchar(32) NOT NULL DEFAULT 'staff',
	`status` enum('invited','active','deactivated') NOT NULL DEFAULT 'invited',
	`password_hash` varchar(255),
	`password_changed_at` datetime(3),
	`mfa_required` boolean NOT NULL DEFAULT false,
	`totp_secret_enc` varchar(255),
	`totp_pending_enc` varchar(255),
	`totp_enabled_at` datetime(3),
	`totp_last_step` bigint,
	`failed_logins` smallint NOT NULL DEFAULT 0,
	`locked_until` datetime(3),
	`last_sign_in_at` datetime(3),
	`invited_by` varchar(36),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_uq` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `auth_tokens` ADD CONSTRAINT `auth_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_receipt_file_id_files_id_fk` FOREIGN KEY (`receipt_file_id`) REFERENCES `files`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `expenses` ADD CONSTRAINT `expenses_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `files` ADD CONSTRAINT `files_uploaded_by_users_id_fk` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_stream_id_streams_id_fk` FOREIGN KEY (`stream_id`) REFERENCES `streams`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_country_code_countries_code_fk` FOREIGN KEY (`country_code`) REFERENCES `countries`(`code`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_representative_id_representatives_id_fk` FOREIGN KEY (`representative_id`) REFERENCES `representatives`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `income_entries` ADD CONSTRAINT `income_entries_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `preset_permissions` ADD CONSTRAINT `preset_permissions_preset_id_role_presets_id_fk` FOREIGN KEY (`preset_id`) REFERENCES `role_presets`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `recovery_codes` ADD CONSTRAINT `recovery_codes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `representatives` ADD CONSTRAINT `representatives_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `representatives` ADD CONSTRAINT `representatives_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_permissions` ADD CONSTRAINT `user_permissions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_preset_id_role_presets_id_fk` FOREIGN KEY (`preset_id`) REFERENCES `role_presets`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit_log` (`at`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_id`);--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE INDEX `auth_tokens_user_idx` ON `auth_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `expense_date_idx` ON `expenses` (`expense_date`);--> statement-breakpoint
CREATE INDEX `expense_created_by_idx` ON `expenses` (`created_by`);--> statement-breakpoint
CREATE INDEX `files_entity_idx` ON `files` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `income_date_idx` ON `income_entries` (`entry_date`);--> statement-breakpoint
CREATE INDEX `income_created_by_idx` ON `income_entries` (`created_by`);--> statement-breakpoint
CREATE INDEX `income_rep_idx` ON `income_entries` (`representative_id`);--> statement-breakpoint
CREATE INDEX `recovery_codes_user_idx` ON `recovery_codes` (`user_id`);--> statement-breakpoint
CREATE INDEX `reps_user_idx` ON `representatives` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `users_preset_idx` ON `users` (`preset_id`);