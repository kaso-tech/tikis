CREATE TABLE `tikisse_deliveries` (
	`id` varchar(40) NOT NULL,
	`senderPhone` varchar(20) NOT NULL,
	`pickupPlaceId` int NOT NULL,
	`dropoffPlaceId` int NOT NULL,
	`title` varchar(120) NOT NULL,
	`details` varchar(450) NOT NULL,
	`deliveryType` enum('Plis','Personne','Autre') NOT NULL,
	`status` enum('draft','open','pending_confirmation','active','completed','disabled','cancelled') NOT NULL DEFAULT 'open',
	`distanceKm` decimal(10,2) NOT NULL,
	`routeSource` enum('routes','provisional') NOT NULL DEFAULT 'provisional',
	`estimatedPrice` int NOT NULL,
	`offeredPrice` int,
	`vehicleTypes` varchar(120) NOT NULL,
	`weightKg` decimal(8,2),
	`lengthCm` int,
	`widthCm` int,
	`heightCm` int,
	`passengers` int,
	`driverPhone` varchar(20),
	`previousDriverPhone` varchar(20),
	`selectedAt` timestamp,
	`confirmedAt` timestamp,
	`completedAt` timestamp,
	`cancelledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikisse_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tikisse_delivery_candidates` (
	`id` varchar(40) NOT NULL,
	`deliveryId` varchar(40) NOT NULL,
	`driverPhone` varchar(20) NOT NULL,
	`offerPrice` int,
	`status` enum('applied','selected','confirmed','withdrawn','replaced') NOT NULL DEFAULT 'applied',
	`commissionBlocked` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikisse_delivery_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikisse_delivery_candidates_delivery_driver_unique` UNIQUE(`deliveryId`,`driverPhone`)
);
--> statement-breakpoint
CREATE INDEX `tikisse_deliveries_sender_status_index` ON `tikisse_deliveries` (`senderPhone`,`status`);--> statement-breakpoint
CREATE INDEX `tikisse_deliveries_driver_status_index` ON `tikisse_deliveries` (`driverPhone`,`status`);--> statement-breakpoint
CREATE INDEX `tikisse_deliveries_status_created_index` ON `tikisse_deliveries` (`status`,`createdAt`);--> statement-breakpoint
CREATE INDEX `tikisse_delivery_candidates_delivery_status_index` ON `tikisse_delivery_candidates` (`deliveryId`,`status`);--> statement-breakpoint
CREATE INDEX `tikisse_delivery_candidates_driver_status_index` ON `tikisse_delivery_candidates` (`driverPhone`,`status`);