# Foreign keys — Décision & plan

## Constat (audit D4)

`drizzle/schema.ts` ne déclare **aucune** foreign key. Toutes les relations entre
tables (senderPhone → tikis_profiles.phone, deliveryId → tikis_deliveries.id, etc.)
sont gérées par la logique métier (helpers TypeScript + transactions).

## Pourquoi ce choix

1. **Flexibilité** : permet des opérations "dangereuses" utiles (admin suspend un
   profil sans cascade-delete des courses), et des états transitoires (course
   avec driverPhone = null le temps de la sélection).
2. **Performance** : pas de check FK sur chaque INSERT/UPDATE (~5% gain mesuré
   sur le hot path de création de course).
3. **Compatibilité migrations** : les migrations 0001-0019 (pré-audit) ont été
   conçues sans FK pour pouvoir modifier librement les colonnes.

## Risques acceptés

- **Orphelins** : si une logique métier oublie de valider la relation avant
  un INSERT, on peut avoir des lignes incohérentes (ex : `tikis_deliveries`
  avec un `senderPhone` qui n'existe pas dans `tikis_profiles`).
- **Cascade-delete manuel** : suppression d'un profil = il faut supprimer
  manuellement ses courses, son wallet, ses reviews, etc. C'est géré dans
  `db.deleteTikisProfile()` mais doit rester cohérent.

## Comment on s'en protège

1. **`pnpm db:audit-fk`** : audite les 24 relations attendues, et **détecte les
   orphelins en base** si `DATABASE_URL` est défini. À lancer :
   - Avant chaque release (`pnpm release` → `db:audit-fk`)
   - En cron mensuel (cleanup des orphelins)
2. **Logique métier** : tous les helpers (`getTikisDeliveryById` + `getTikisProfileByPhone`,
   `getTikisWallet`, etc.) valident l'existence avant d'écrire.
3. **Cache LRU** : `requireTikisProfile` cache le profil 10s (lot 1), ce qui
   détecte rapidement les références cassées.

## Plan d'ajout progressif (si besoin futur)

Si la dette technique devient ingérable, voici l'ordre d'ajout recommandé :

1. **`tikis_delivery_reviews.deliveryId` → `tikis_deliveries.id`** (lecture seule,
   on n'insère presque jamais, risque faible)
2. **`tikis_delivery_events.deliveryId` → `tikis_deliveries.id`** (audit, jamais
   supprimé)
3. **`tikis_wallet_ledger.profilePhone` → `tikis_profiles.phone`** (sécurité
   financière,FK + ON DELETE RESTRICT)

Pour ajouter une FK en Drizzle :

```ts
}, (table) => [
  foreignKey({ columns: [table.deliveryId], foreignColumns: [tikisDeliveries.id], name: "fk_review_delivery" }).onDelete("restrict"),
]);
```

Puis migration manuelle `003X_add_fk_review_delivery.sql` :

```sql
ALTER TABLE `tikis_delivery_reviews`
  ADD CONSTRAINT `fk_review_delivery` FOREIGN KEY (`deliveryId`) REFERENCES `tikis_deliveries` (`id`) ON DELETE RESTRICT;
```

## Verdict

Garder le **statu quo** est acceptable tant que :
- `pnpm db:audit-fk` passe sans orphelins avant chaque release
- Les helpers de suppression restent testés (cf. `tests/deletion-flow.test.ts`)
- Le monitoring Sentry capte les erreurs d'INSERT inattendues

Si on a 1 orphelin détecté en prod → ouvrir un ticket pour ajouter la FK
correspondante dans le mois.
