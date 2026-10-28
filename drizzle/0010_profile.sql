ALTER TABLE `users` ADD `phone` varchar(40) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_key` varchar(64);--> statement-breakpoint
ALTER TABLE `users` ADD `avatar_updated_at` datetime(3);