ALTER TABLE `tikisse_delivery_events` ADD `idempotencyKey` varchar(100);
--> statement-breakpoint
UPDATE `tikisse_delivery_events` SET `idempotencyKey` = CONCAT('legacy-', `id`) WHERE `idempotencyKey` IS NULL;
--> statement-breakpoint
ALTER TABLE `tikisse_delivery_events` MODIFY `idempotencyKey` varchar(100) NOT NULL;
--> statement-breakpoint
ALTER TABLE `tikisse_delivery_events` ADD CONSTRAINT `tikisse_delivery_events_idempotencyKey_unique` UNIQUE(`idempotencyKey`);
