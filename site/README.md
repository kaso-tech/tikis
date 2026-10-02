# Site vitrine Tikisse

Cette arborescence contient le code source statique complet du site vitrine Tikisse.

## Build

Aucune compilation ni dépendance n’est nécessaire.

- Commande de build : `true`
- Répertoire de sortie : `public/`

Dans le déploiement WebDev d’origine, la commande est exécutée à la racine du projet et publie directement `public/`. Dans cette copie, exécutez-la depuis `site/` ; la sortie reste donc `site/public/` depuis la racine du dépôt.

## Prévisualisation locale

```bash
cd site
python3 -m http.server 3000 --directory public
```

Les fichiers sont statiques. Aucun secret, aucune clé d’API et aucune dépendance ne sont requis.
