CREATE TABLE `tikis_favorite_places` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profilePhone` varchar(20) NOT NULL,
	`placeId` int NOT NULL,
	`label` varchar(80) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `tikis_favorite_places_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_favorite_places_profile_place_unique` UNIQUE(`profilePhone`,`placeId`)
);
--> statement-breakpoint
CREATE TABLE `tikis_places` (
	`id` int AUTO_INCREMENT NOT NULL,
	`googlePlaceId` varchar(255),
	`latitude` decimal(10,7) NOT NULL,
	`longitude` decimal(10,7) NOT NULL,
	`formattedAddress` varchar(255) NOT NULL,
	`placeName` varchar(140) NOT NULL,
	`street` varchar(160),
	`district` varchar(120),
	`city` varchar(120),
	`province` varchar(120),
	`country` varchar(120),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikis_places_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_places_googlePlaceId_unique` UNIQUE(`googlePlaceId`)
);
