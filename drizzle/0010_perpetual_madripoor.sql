CREATE TABLE `tikis_platform_settings` (
	`id` int NOT NULL,
	`commissionRate` decimal(6,5) NOT NULL DEFAULT '0.10000',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikis_platform_settings_id` PRIMARY KEY(`id`)
);
