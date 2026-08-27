ALTER TABLE `tikis_places` ADD `provider` varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_places` ADD `source` varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_places` ADD `featureType` varchar(32) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_places` ADD `precision` varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_places` ADD `coordinateKey` varchar(32) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_places` ADD `resolvedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `tikis_places_coordinate_key_index` ON `tikis_places` (`coordinateKey`);