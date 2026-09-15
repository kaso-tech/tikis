-- Index de support pour la déduplication par proximité des lieux saisis manuellement
-- (server/db.ts, findNearbyManualTikisPlace) : sans lui, la pré-sélection par bornes de latitude/longitude
-- ferait un scan complet de `tikis_places` à chaque enregistrement de lieu.
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0035_places_coordinates_index.sql
--
-- MySQL ne connaît pas `CREATE INDEX IF NOT EXISTS` : sans le garde ci-dessous, rejouer ce fichier
-- échouait sur « Duplicate key name » et interrompait l'application d'un lot de migrations.
SET @index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'tikis_places'
    AND INDEX_NAME = 'tikis_places_coordinates_index'
);

SET @statement := IF(
  @index_exists = 0,
  'CREATE INDEX `tikis_places_coordinates_index` ON `tikis_places` (`latitude`, `longitude`)',
  'SELECT "tikis_places_coordinates_index déjà présent, rien à faire" AS info'
);

PREPARE apply_index FROM @statement;
EXECUTE apply_index;
DEALLOCATE PREPARE apply_index;
