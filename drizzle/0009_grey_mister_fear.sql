CREATE TABLE `tikis_delivery_events` (
	`id` varchar(40) NOT NULL,
	`deliveryId` varchar(40) NOT NULL,
	`eventType` varchar(48) NOT NULL,
	`status` enum('draft','open','pending_confirmation','active','completed','disabled','cancelled'),
	`actorPhone` varchar(20),
	`recipientPhone` varchar(20) NOT NULL,
	`title` varchar(120) NOT NULL,
	`body` varchar(300) NOT NULL,
	`tone` enum('info','success','warning') NOT NULL DEFAULT 'info',
	`metadata` text,
	`readAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_delivery_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tikis_wallet_ledger` (
	`id` varchar(40) NOT NULL,
	`profilePhone` varchar(20) NOT NULL,
	`deliveryId` varchar(40),
	`operation` enum('block','unblock','debit','compensation','credit','refund','deposit_request','withdrawal_request') NOT NULL,
	`amount` int NOT NULL,
	`availableBefore` int NOT NULL,
	`availableAfter` int NOT NULL,
	`heldBefore` int NOT NULL,
	`heldAfter` int NOT NULL,
	`reason` varchar(255) NOT NULL,
	`idempotencyKey` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_wallet_ledger_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_wallet_ledger_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE TABLE `tikis_wallets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profilePhone` varchar(20) NOT NULL,
	`availableBalance` int NOT NULL DEFAULT 0,
	`heldBalance` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'XOF',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_wallets_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_wallets_profilePhone_unique` UNIQUE(`profilePhone`)
);
--> statement-breakpoint
CREATE INDEX `tikis_delivery_events_recipient_created_index` ON `tikis_delivery_events` (`recipientPhone`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tikis_delivery_events_delivery_created_index` ON `tikis_delivery_events` (`deliveryId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tikis_wallet_ledger_profile_created_index` ON `tikis_wallet_ledger` (`profilePhone`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tikis_wallet_ledger_delivery_index` ON `tikis_wallet_ledger` (`deliveryId`);