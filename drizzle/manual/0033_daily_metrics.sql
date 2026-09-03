-- Table de métriques business quotidiennes.
-- Alimentée par le cron /api/scheduled/compute-daily-metrics (1 fois/jour).
--
-- Permet de voir les tendances GMV / commission sans ré-agréger tikis_deliveries.

CREATE TABLE IF NOT EXISTS `tikis_daily_metrics` (
  `date` varchar(10) NOT NULL,
  `deliveriesCreated` int NOT NULL DEFAULT 0,
  `deliveriesCompleted` int NOT NULL DEFAULT 0,
  `deliveriesCancelled` int NOT NULL DEFAULT 0,
  `gmvTotal` int NOT NULL DEFAULT 0,
  `commissionTotal` int NOT NULL DEFAULT 0,
  `newDrivers` int NOT NULL DEFAULT 0,
  `newSenders` int NOT NULL DEFAULT 0,
  `activeDrivers` int NOT NULL DEFAULT 0,
  `activeSenders` int NOT NULL DEFAULT 0,
  `bonusAwarded` int NOT NULL DEFAULT 0,
  `reportsOpened` int NOT NULL DEFAULT 0,
  `computedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`date`),
  INDEX `tikis_daily_metrics_date_index` (`date`)
);
