CREATE TABLE `tikis_payment_transactions` (
	`id` varchar(40) NOT NULL,
	`profilePhone` varchar(20) NOT NULL,
	`type` enum('deposit','withdrawal') NOT NULL,
	`provider` enum('ligdi_simulated') NOT NULL DEFAULT 'ligdi_simulated',
	`amount` int NOT NULL,
	`status` enum('pending','succeeded','failed','cancelled') NOT NULL DEFAULT 'pending',
	`providerReference` varchar(80) NOT NULL,
	`idempotencyKey` varchar(100) NOT NULL,
	`settledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_payment_transactions_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_payment_transactions_providerReference_unique` UNIQUE(`providerReference`),
	CONSTRAINT `tikis_payment_transactions_idempotencyKey_unique` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE INDEX `tikis_payment_transactions_profile_created_index` ON `tikis_payment_transactions` (`profilePhone`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tikis_payment_transactions_status_index` ON `tikis_payment_transactions` (`status`,`createdAt`);