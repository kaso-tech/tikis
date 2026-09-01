ALTER TABLE `tikis_profiles` ADD `email` varchar(320);--> statement-breakpoint
ALTER TABLE `tikis_profiles` ADD `phoneVerified` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `tikis_profiles` ADD `emailVerified` boolean DEFAULT false NOT NULL;