# Audit Wallet et candidatures

| Parcours | Composant exécuté | Mouvement attendu | Défaut identifié | Correction |
|---|---|---|---|---|
| Postulation simple | Accueil natif et web | Réserver la commission | Le parcours web ne gérait que `requestApply` et les anciennes clés d’idempotence pouvaient réutiliser une écriture d’un cycle antérieur | Confirmation financière obligatoire, montant confirmé exigé par le serveur et clé versionnée par cycle |
| Contre-proposition | Fiche livraison | Ajuster la commission réservée | Une succession de montants identiques pouvait rencontrer une ancienne clé d’ajustement | Clé versionnée avec la dernière mise à jour de candidature |
| Renonciation | Accueil et fiche livraison | Libérer la commission réservée | Le bouton web « Renoncer » appelait le parcours de postulation et une ancienne clé `withdraw` pouvait bloquer une nouvelle libération | Mutation `withdraw` dédiée, popup dédié, snapshot retourné et clé versionnée |
| Confirmation de mission | Accueil et fiche livraison | Prélever la commission réservée | L’accueil web n’appelait pas la mutation `confirm` | Mutation `confirm` dédiée, popup dédié et snapshot Wallet écrit immédiatement |
| Annulation expéditeur | Serveur et temps réel | Libérer les réservations ou compenser un débit antérieur | La libération pouvait être dédupliquée par une clé d’un cycle précédent | Libération versionnée par candidature et compensation limitée aux anciens débits persistés |

Le serveur refuse maintenant toute nouvelle postulation qui ne fournit pas le montant de commission explicitement confirmé. Les écrans mettent à jour le cache Wallet avec le snapshot retourné par la transaction, puis lancent une resynchronisation réseau de contrôle.
