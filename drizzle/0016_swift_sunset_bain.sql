CREATE TABLE `tikis_delivery_live_locations` (
	`deliveryId` varchar(40) NOT NULL,
	`driverPhone` varchar(20) NOT NULL,
	`latitude` decimal(10,7) NOT NULL,
	`longitude` decimal(10,7) NOT NULL,
	`heading` decimal(6,2) NOT NULL DEFAULT '0',
	`recordedAt` timestamp NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikis_delivery_live_locations_deliveryId` PRIMARY KEY(`deliveryId`)
);
--> statement-breakpoint
CREATE INDEX `tikis_delivery_live_locations_driver_index` ON `tikis_delivery_live_locations` (`driverPhone`,`updatedAt`);