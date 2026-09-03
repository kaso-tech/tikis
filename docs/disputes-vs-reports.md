# Signalements vs Litiges — décision produit

## État actuel

**Une seule table** : `tikis_delivery_reports` (alias "signalements").

Historique : une table `tikis_disputes` (alias "litiges") avait été évoquée pour un
workflow de médiation plus poussé (échange contradictoire, score de confiance, etc.).
**Elle n'a jamais été implémentée** : tout passe par `tikis_delivery_reports`.

## Pourquoi pas deux tables ?

Un signalement sender/driver et un litige sont **le même concept** du point de vue
produit : un utilisateur remonte un problème sur une livraison, l'administration
examine et tranche. La nuance "litige = procédure contradictoire" ne se justifie pas
aujourd'hui car :

- Volume attendu : faible (1-2 signalements / semaine au lancement).
- L'admin a déjà un timeline complet (livraison, événements, finance, signalements)
  via `disputes.timeline` qui agrège toutes les sources.
- Une seule table = un seul set de statuts, plus simple à auditer.

## Quand recréer `tikis_disputes` ?

Si l'un de ces seuils est franchi :

1. **Volume** : > 50 signalements ouverts simultanément pendant 2 semaines.
2. **Workflow** : nécessité d'un score de confiance, d'une procédure contradictoire
   (réponse du driver obligatoire), d'un SLA différent selon la sévérité.
3. **Multi-claim** : une même livraison avec 3+ signalements simultanés qui se
   contredisent (sender dit "perdu", driver dit "livré") — actuellement on traite ça
   à la main via l'admin console.

## Migration future

Si on recrée `tikis_disputes`, la migration sera non destructive :
```sql
CREATE TABLE tikis_disputes (
  id varchar(40) PRIMARY KEY,
  reportId varchar(40) NOT NULL,  -- FK vers tikis_delivery_reports.id
  deliveryId varchar(40) NOT NULL,
  -- colonnes spécifiques au workflow contradictoire
  ...
);
ALTER TABLE tikis_disputes ADD CONSTRAINT fk_dispute_report
  FOREIGN KEY (reportId) REFERENCES tikis_delivery_reports(id);
```

