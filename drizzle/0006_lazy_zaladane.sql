ALTER TABLE `tikisse_places` ADD `provider` varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD `source` varchar(16) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD `featureType` varchar(32) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD `precision` varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD `coordinateKey` varchar(32) DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE `tikisse_places` ADD `resolvedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
CREATE INDEX `tikisse_places_coordinate_key_index` ON `tikisse_places` (`coordinateKey`);