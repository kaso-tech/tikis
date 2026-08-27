ALTER TABLE `tikis_delivery_events` ADD `idempotencyKey` varchar(100);
--> statement-breakpoint
UPDATE `tikis_delivery_events` SET `idempotencyKey` = CONCAT('legacy-', `id`) WHERE `idempotencyKey` IS NULL;
--> statement-breakpoint
ALTER TABLE `tikis_delivery_events` MODIFY `idempotencyKey` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `tikis_delivery_events` ADD CONSTRAINT `tikis_delivery_events_idempotencyKey_unique` UNIQUE(`idempotencyKey`);
