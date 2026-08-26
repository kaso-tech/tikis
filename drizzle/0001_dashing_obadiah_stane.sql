CREATE TABLE `tikis_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`fullName` varchar(70) NOT NULL,
	`accountType` enum('sender','driver') NOT NULL,
	`vehicles` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tikis_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `tikis_profiles_phone_unique` UNIQUE(`phone`)
);
