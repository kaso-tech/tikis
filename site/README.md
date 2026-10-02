# Site vitrine Tikisse

Pages statiques servies sur **tikisse.com** par le serveur Tikisse (Render) — `www.tikisse.com` y renvoie.
Aucune compilation ni dépendance : le serveur publie directement `site/public/`
(voir `server/_core/console-host.ts` et `server/_core/index.ts`).

Les adresses du site (canonique, partage, `robots.txt`, `sitemap.xml`) pointent vers `https://tikisse.com`.

## Prévisualisation locale

```bash
python3 -m http.server 3000 --directory site/public
```

Aucun secret, aucune clé d'API.
