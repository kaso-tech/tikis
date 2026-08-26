ALTER TABLE `tikis_places` ADD `mapboxPlaceId` varchar(255);--> statement-breakpoint
ALTER TABLE `tikis_places` ADD COLUMN `mapboxPlaceId` varchar(255);
ALTER TABLE `tikis_places` ADD CONSTRAINT `tikis_places_mapboxPlaceId_unique` UNIQUE(`mapboxPlaceId`);
