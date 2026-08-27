CREATE TABLE `tikis_delivery_reviews` (
	`id` varchar(40) NOT NULL,
	`deliveryId` varchar(40) NOT NULL,
	`reviewerPhone` varchar(20) NOT NULL,
	`driverPhone` varchar(20) NOT NULL,
	`rating` int NOT NULL,
	`comment` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_delivery_reviews_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_delivery_reviews_delivery_reviewer_unique` UNIQUE(`deliveryId`,`reviewerPhone`)
);
--> statement-breakpoint
CREATE INDEX `tikis_delivery_reviews_driver_index` ON `tikis_delivery_reviews` (`driverPhone`);