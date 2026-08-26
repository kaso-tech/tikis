ALTER TABLE `tikis_profiles` ADD `referralCode` varchar(8);
ALTER TABLE `tikis_profiles` ADD CONSTRAINT `tikis_profiles_referralCode_unique` UNIQUE(`referralCode`);
