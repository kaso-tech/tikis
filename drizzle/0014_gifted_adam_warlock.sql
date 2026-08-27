ALTER TABLE `tikis_profiles` ADD `supabaseUserId` varchar(64);--> statement-breakpoint
ALTER TABLE `tikis_profiles` ADD COLUMN IF NOT EXISTS `supabaseUserId` varchar(64);--> statement-breakpoint
ALTER TABLE `tikis_profiles` ADD CONSTRAINT `tikis_profiles_supabaseUserId_unique` UNIQUE(`supabaseUserId`);
