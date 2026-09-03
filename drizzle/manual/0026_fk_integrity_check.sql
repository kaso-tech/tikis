-- Vérification d'intégrité référentielle (lecture seule).
-- Avant de pouvoir ajouter des FK explicites (D4), on s'assure qu'aucune ligne n'est
-- orpheline : si une de ces requêtes renvoie un résultat non vide, c'est qu'il y a
-- des données incohérentes à nettoyer AVANT d'ajouter la contrainte FK.
--
-- Appliquer : mysql -u <user> -p <database> < drizzle/manual/0026_fk_integrity_check.sql

SELECT 'orphan_pickup_place' AS check_name, COUNT(*) AS violations FROM tikis_deliveries d LEFT JOIN tikis_places p ON p.id = d.pickupPlaceId WHERE p.id IS NULL;
SELECT 'orphan_dropoff_place' AS check_name, COUNT(*) AS violations FROM tikis_deliveries d LEFT JOIN tikis_places p ON p.id = d.dropoffPlaceId WHERE p.id IS NULL;
SELECT 'orphan_sender_profile' AS check_name, COUNT(*) AS violations FROM tikis_deliveries d LEFT JOIN tikis_profiles p ON p.phone = d.senderPhone WHERE p.phone IS NULL;
SELECT 'orphan_driver_profile' AS check_name, COUNT(*) AS violations FROM tikis_deliveries d LEFT JOIN tikis_profiles p ON p.phone = d.driverPhone WHERE d.driverPhone IS NOT NULL AND p.phone IS NULL;
SELECT 'orphan_candidate_driver' AS check_name, COUNT(*) AS violations FROM tikis_delivery_candidates c LEFT JOIN tikis_profiles p ON p.phone = c.driverPhone WHERE p.phone IS NULL;
SELECT 'orphan_candidate_delivery' AS check_name, COUNT(*) AS violations FROM tikis_delivery_candidates c LEFT JOIN tikis_deliveries d ON d.id = c.deliveryId WHERE d.id IS NULL;
SELECT 'orphan_event_delivery' AS check_name, COUNT(*) AS violations FROM tikis_delivery_events e LEFT JOIN tikis_deliveries d ON d.id = e.deliveryId WHERE d.id IS NULL;
