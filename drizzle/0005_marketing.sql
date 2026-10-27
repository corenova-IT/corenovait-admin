CREATE TABLE `campaigns` (
	`id` varchar(36) NOT NULL,
	`name` varchar(120) NOT NULL,
	`channel` enum('email','cold_call','direct','individual_referral','social','other'),
	`status` enum('planned','active','paused','finished') NOT NULL DEFAULT 'active',
	`start_date` date,
	`end_date` date,
	`description` varchar(500) NOT NULL DEFAULT '',
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `campaign_name_uq` UNIQUE(`name`),
	CONSTRAINT `campaign_dates_chk` CHECK(`campaigns`.`end_date` is null or `campaigns`.`start_date` is null or `campaigns`.`end_date` >= `campaigns`.`start_date`)
);
--> statement-breakpoint
CREATE TABLE `marketing_activities` (
	`id` varchar(36) NOT NULL,
	`occurred_at` datetime(3) NOT NULL,
	`channel` enum('email','cold_call','direct','individual_referral','social','other') NOT NULL,
	`campaign_id` varchar(36),
	`contact_name` varchar(200) NOT NULL,
	`contact_company` varchar(200) NOT NULL DEFAULT '',
	`outcome` enum('no_response','replied','meeting','deal_won','deal_lost') NOT NULL,
	`deal_value_minor` bigint,
	`deal_currency` char(3),
	`deal_fx_rate_to_base` decimal(18,8),
	`deal_value_base_minor` bigint GENERATED ALWAYS AS (round(`deal_value_minor` * `deal_fx_rate_to_base`)) STORED,
	`owner_id` varchar(36) NOT NULL,
	`notes` text,
	`is_sample` boolean NOT NULL DEFAULT false,
	`created_by` varchar(36) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `marketing_activities_id` PRIMARY KEY(`id`),
	CONSTRAINT `mkt_deal_value_chk` CHECK((`marketing_activities`.`deal_value_minor` is null and `marketing_activities`.`deal_currency` is null and `marketing_activities`.`deal_fx_rate_to_base` is null) or (`marketing_activities`.`outcome` = 'deal_won' and `marketing_activities`.`deal_value_minor` > 0 and `marketing_activities`.`deal_currency` regexp '^[A-Z]{3}$' and `marketing_activities`.`deal_fx_rate_to_base` > 0))
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_activities` ADD CONSTRAINT `marketing_activities_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_activities` ADD CONSTRAINT `marketing_activities_owner_id_users_id_fk` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `marketing_activities` ADD CONSTRAINT `marketing_activities_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `mkt_occurred_idx` ON `marketing_activities` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `mkt_owner_idx` ON `marketing_activities` (`owner_id`);--> statement-breakpoint
CREATE INDEX `mkt_created_by_idx` ON `marketing_activities` (`created_by`);--> statement-breakpoint
CREATE INDEX `mkt_campaign_idx` ON `marketing_activities` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `mkt_channel_idx` ON `marketing_activities` (`channel`,`occurred_at`);