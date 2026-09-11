-- Index de support pour la déduplication par proximité des lieux saisis manuellement
-- (server/db.ts, findNearbyManualTikisPlace) : sans lui, la pré-sélection par bornes de latitude/longitude
-- ferait un scan complet de `tikis_places` à chaque enregistrement de lieu.
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0035_places_coordinates_index.sql
CREATE INDEX `tikis_places_coordinates_index` ON `tikis_places` (`latitude`, `longitude`);
