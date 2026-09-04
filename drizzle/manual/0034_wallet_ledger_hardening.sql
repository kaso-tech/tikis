-- Durcissement du journal financier (tikis_wallet_ledger).
-- Cette base étant en MySQL (voir drizzle.config.ts), appliquer directement :
--   mysql -u <user> -p <database> < drizzle/manual/0034_wallet_ledger_hardening.sql
--
-- Deux corrections indépendantes, dans cet ordre précis (l'ordre compte : le trigger
-- d'immuabilité ajouté à l'étape 2 interdirait le UPDATE de backfill de l'étape 1) :
--
-- 1. Sépare le débit de commission Tikis (revenu réel de la plateforme) du débit générique
--    de retrait (argent d'un utilisateur qui sort de son propre Wallet). Auparavant les deux
--    partageaient la valeur "debit", ce qui gonflait le KPI "commissionRevenue" de l'admin dès
--    qu'un retrait avait lieu sur la période. Un backfill met à jour l'historique existant.
-- 2. Ajoute l'immuabilité (BEFORE UPDATE / BEFORE DELETE) sur tikis_wallet_ledger, au même titre
--    que tikis_admin_audit_log (0020_admin_console.sql) — ce trigger était documenté comme
--    devant exister (référencé par le commentaire de 0020) mais n'avait en réalité jamais été créé.

-- 1a. Nouvelle valeur d'enum.
ALTER TABLE `tikis_wallet_ledger`
  MODIFY COLUMN `operation` enum('block','unblock','debit','commission_debit','compensation','credit','refund','deposit_request','withdrawal_request','bonus','penalty') NOT NULL;

-- 1b. Backfill : les seules écritures "debit" historiques correspondant à un prélèvement réel de
-- commission Tikis portent exactement ce motif (server/db.ts, confirmTikisDeliveryWithEvents).
-- Toutes les autres valeurs de "debit" (retraits YengaPay test/live, retraits validés par l'admin)
-- restent inchangées à juste titre : ce ne sont jamais des revenus de la plateforme.
UPDATE `tikis_wallet_ledger`
SET `operation` = 'commission_debit'
WHERE `operation` = 'debit'
  AND `reason` = 'Commission Tikis prélevée après confirmation de disponibilité';

-- 2. Immuabilité du journal financier, même logique que 0020_admin_console.sql pour tikis_admin_audit_log.
DROP TRIGGER IF EXISTS tikis_wallet_ledger_no_update;
DROP TRIGGER IF EXISTS tikis_wallet_ledger_no_delete;

DELIMITER $$

CREATE TRIGGER tikis_wallet_ledger_no_update
BEFORE UPDATE ON tikis_wallet_ledger
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'tikis_wallet_ledger est immuable : la modification d’une écriture du journal financier est interdite.';
END$$

CREATE TRIGGER tikis_wallet_ledger_no_delete
BEFORE DELETE ON tikis_wallet_ledger
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'tikis_wallet_ledger est immuable : la suppression d’une écriture du journal financier est interdite.';
END$$

DELIMITER ;
