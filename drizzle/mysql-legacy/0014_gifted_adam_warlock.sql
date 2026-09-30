ALTER TABLE `tikisse_profiles` ADD `supabaseUserId` varchar(64);--> statement-breakpoint
ALTER TABLE `tikisse_profiles` ADD COLUMN IF NOT EXISTS `supabaseUserId` varchar(64);--> statement-breakpoint
ALTER TABLE `tikisse_profiles` ADD CONSTRAINT `tikisse_profiles_supabaseUserId_unique` UNIQUE(`supabaseUserId`);
