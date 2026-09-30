ALTER TABLE `tikisse_profiles` ADD `referralCode` varchar(8);
ALTER TABLE `tikisse_profiles` ADD CONSTRAINT `tikisse_profiles_referralCode_unique` UNIQUE(`referralCode`);
