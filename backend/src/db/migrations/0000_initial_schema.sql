CREATE TABLE `campaigns` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`sender_id` char(36) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body_html` mediumtext NOT NULL,
	`body_text` mediumtext NOT NULL,
	`preview_text` varchar(200) NOT NULL,
	`start_at` datetime(3) NOT NULL,
	`delay_between_ms` int unsigned NOT NULL,
	`hourly_limit` int unsigned NOT NULL,
	`recipient_count` int unsigned NOT NULL,
	`idempotency_key` varchar(64) NOT NULL,
	`request_hash` char(64) NOT NULL,
	`enqueued_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_campaigns_user_idem` UNIQUE(`user_id`,`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `emails` (
	`id` char(36) NOT NULL,
	`campaign_id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`sender_id` char(36) NOT NULL,
	`recipient_email` varchar(254) NOT NULL,
	`recipient_name` varchar(255),
	`seq_no` int unsigned NOT NULL,
	`status` enum('scheduled','sending','sent','failed') NOT NULL DEFAULT 'scheduled',
	`folder` varchar(9) GENERATED ALWAYS AS (if(`status` in ('sent','failed'),'sent','scheduled')) STORED,
	`scheduled_at` datetime(3) NOT NULL,
	`original_scheduled_at` datetime(3) NOT NULL,
	`defer_count` int unsigned NOT NULL DEFAULT 0,
	`last_deferred_reason` enum('sender_hourly_limit','campaign_hourly_limit'),
	`attempt_count` int unsigned NOT NULL DEFAULT 0,
	`claim_token` char(36),
	`lease_until` datetime(3),
	`sent_at` datetime(3),
	`failed_at` datetime(3),
	`completed_at` datetime(3),
	`message_id` varchar(255),
	`smtp_response` varchar(512),
	`preview_url` varchar(512),
	`error_code` varchar(64),
	`error_message` varchar(1000),
	`version` int unsigned NOT NULL DEFAULT 1,
	`indexed_version` int unsigned NOT NULL DEFAULT 0,
	`search_dirty` boolean GENERATED ALWAYS AS ((`indexed_version` < `version`)) STORED,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `emails_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_emails_campaign_recipient` UNIQUE(`campaign_id`,`recipient_email`),
	CONSTRAINT `uq_emails_campaign_seq` UNIQUE(`campaign_id`,`seq_no`)
);
--> statement-breakpoint
CREATE TABLE `senders` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`label` varchar(100) NOT NULL,
	`from_name` varchar(255) NOT NULL,
	`from_email` varchar(320) NOT NULL,
	`provider` enum('ethereal') NOT NULL DEFAULT 'ethereal',
	`smtp_host` varchar(255) NOT NULL,
	`smtp_port` smallint unsigned NOT NULL,
	`smtp_secure` boolean NOT NULL,
	`smtp_user` varchar(320) NOT NULL,
	`smtp_pass_enc` varchar(512) NOT NULL,
	`hourly_limit` int unsigned,
	`min_delay_ms` int unsigned,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `senders_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_senders_user_from` UNIQUE(`user_id`,`from_email`)
);
--> statement-breakpoint
CREATE TABLE `slack_connections` (
	`id` char(36) NOT NULL,
	`user_id` char(36) NOT NULL,
	`team_id` varchar(32) NOT NULL,
	`team_name` varchar(255) NOT NULL,
	`channel_id` varchar(32) NOT NULL,
	`channel_name` varchar(255) NOT NULL,
	`app_id` varchar(32) NOT NULL,
	`bot_user_id` varchar(32),
	`slack_user_id` varchar(32),
	`scopes` varchar(512) NOT NULL,
	`webhook_url_enc` varchar(1024),
	`bot_token_enc` varchar(1024),
	`status` enum('active','revoked','invalid') NOT NULL,
	`last_notified_at` datetime(3),
	`last_error` varchar(500),
	`connected_at` datetime(3) NOT NULL,
	`revoked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `slack_connections_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_slack_connections_user` UNIQUE(`user_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` char(36) NOT NULL,
	`google_sub` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`name` varchar(255) NOT NULL,
	`avatar_url` varchar(2048),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`last_login_at` datetime(3) NOT NULL,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_users_google_sub` UNIQUE(`google_sub`)
);
--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `campaigns` ADD CONSTRAINT `campaigns_sender_id_senders_id_fk` FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emails` ADD CONSTRAINT `emails_campaign_id_campaigns_id_fk` FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emails` ADD CONSTRAINT `emails_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `emails` ADD CONSTRAINT `emails_sender_id_senders_id_fk` FOREIGN KEY (`sender_id`) REFERENCES `senders`(`id`) ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `senders` ADD CONSTRAINT `senders_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `slack_connections` ADD CONSTRAINT `slack_connections_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ix_campaigns_enqueue` ON `campaigns` (`enqueued_at`,`created_at`);--> statement-breakpoint
CREATE INDEX `ix_campaigns_sender` ON `campaigns` (`sender_id`);--> statement-breakpoint
CREATE INDEX `ix_emails_user_folder_sched` ON `emails` (`user_id`,`folder`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `ix_emails_user_folder_done` ON `emails` (`user_id`,`folder`,`completed_at`);--> statement-breakpoint
CREATE INDEX `ix_emails_status_sched` ON `emails` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `ix_emails_status_lease` ON `emails` (`status`,`lease_until`);--> statement-breakpoint
CREATE INDEX `ix_emails_search_dirty` ON `emails` (`search_dirty`,`updated_at`);--> statement-breakpoint
CREATE INDEX `ix_emails_sender` ON `emails` (`sender_id`);