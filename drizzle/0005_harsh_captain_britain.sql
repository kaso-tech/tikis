ALTER TABLE `tikisse_places` ADD `mapboxPlaceId` varchar(255);--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD COLUMN `mapboxPlaceId` varchar(255);
ALTER TABLE `tikisse_places` ADD CONSTRAINT `tikisse_places_mapboxPlaceId_unique` UNIQUE(`mapboxPlaceId`);
