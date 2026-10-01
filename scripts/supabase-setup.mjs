#!/usr/bin/env node
/**
 * pnpm supabase:setup
 *
 * Exécute supabase/setup.sql (temps réel : participants des livraisons et règles d'accès aux canaux) sur le
 * projet Supabase, par l'API de gestion — en HTTPS, sans connexion PostgreSQL directe. Rejouable sans risque.
 *
 * Variables : SUPABASE_URL (https://<ref>.supabase.co) et SUPABASE_ACCESS_TOKEN (Account → Access Tokens,
 * jeton personnel : à révoquer une fois la mise en service terminée).
 *
 * --injected (ou SUPABASE_CREDENTIALS_INJECTED=1) : le jeton n'est pas dans l'environnement, un proxy ajoute
 * l'en-tête Authorization aux requêtes vers api.supabase.com (identifiants d'un environnement cloud Claude Code).
 *
 * Si Supabase refuse (droits sur le schéma `realtime`), coller le même fichier dans Supabase → SQL Editor.
 */
import "./injected-proxy.mjs";
import "./load-env.js";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import process from "node:process";

const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const projectRef = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(supabaseUrl)?.[1];
const token = process.env.SUPABASE_ACCESS_TOKEN;
const injected = process.argv.includes("--injected") || /^(1|true)$/i.test(process.env.SUPABASE_CREDENTIALS_INJECTED ?? "");
if (!projectRef || (!token && !injected)) {
  console.error("SUPABASE_URL (https://<ref>.supabase.co) et SUPABASE_ACCESS_TOKEN sont requis (ou --injected si un proxy ajoute le jeton).");
  process.exit(1);
}
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const query = fs.readFileSync(path.join(root, "supabase/setup.sql"), "utf8");
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
  body: JSON.stringify({ query }),
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  if (injected && !token && response.status === 401) console.error("Jeton refusé ou absent : vérifier l'identifiant ajouté pour api.supabase.com (en-tête Authorization, préfixe Bearer).");
  console.error(`✗ Échec (${response.status}) : ${(await response.text()).slice(0, 400)}`);
  console.error("→ Coller supabase/setup.sql dans Supabase → SQL Editor, puis Run.");
  process.exit(1);
}
console.log("✓ supabase/setup.sql appliqué.");
console.log("→ Reste à désactiver « Allow public access » dans Supabase → Realtime → Settings, puis : pnpm supabase:check");
