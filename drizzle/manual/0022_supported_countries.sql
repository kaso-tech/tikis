-- Réglage des pays actifs sur la plateforme, gérable depuis la console admin.
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0022_supported_countries.sql

CREATE TABLE IF NOT EXISTS `tikis_supported_countries` (
  `id` varchar(2) NOT NULL,
  `name` varchar(80) NOT NULL,
  `dialCode` varchar(6) NOT NULL,
  `digits` int NOT NULL,
  `groups` varchar(40) NOT NULL,
  `timeZones` varchar(200) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `sortOrder` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
);

-- Seed : reprend exactement la liste précédemment codée en dur dans lib/registration-rules.ts,
-- afin qu'aucun comportement ne change tant que l'administration ne modifie rien.
INSERT INTO `tikis_supported_countries` (`id`, `name`, `dialCode`, `digits`, `groups`, `timeZones`, `enabled`, `sortOrder`) VALUES
  ('BF', 'Burkina Faso', '+226', 8, '2,2,2,2', 'Africa/Ouagadougou', true, 0),
  ('CI', 'Côte d’Ivoire', '+225', 10, '2,2,2,2,2', 'Africa/Abidjan', true, 1),
  ('ML', 'Mali', '+223', 8, '2,2,2,2', 'Africa/Bamako', true, 2),
  ('SN', 'Sénégal', '+221', 9, '2,3,2,2', 'Africa/Dakar', true, 3),
  ('TG', 'Togo', '+228', 8, '2,2,2,2', 'Africa/Lome', true, 4),
  ('GH', 'Ghana', '+233', 9, '2,3,4', 'Africa/Accra', true, 5),
  ('FR', 'France', '+33', 9, '1,2,2,2,2', 'Europe/Paris', true, 6)
ON DUPLICATE KEY UPDATE `id` = `id`;
