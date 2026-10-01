#!/usr/bin/env node
/**
 * pnpm supabase:check
 *
 * Vérifie qu'un projet Supabase est prêt pour Tikisse, avec les variables d'environnement du serveur
 * (.env ou environnement). Ne modifie rien. Chaque problème est donné avec sa correction.
 *
 *   1. variables : présentes, au bon format, secrets assez longs, clé anon ≠ clé service_role ;
 *   2. base : migrations appliquées, RLS partout, accès anonyme fermé, configuration temps réel
 *      (supabase/setup.sql) en place ;
 *   3. Supabase Auth : connexion par téléphone activée (nécessaire au temps réel, et aux vrais SMS) ;
 *   4. stockage : bucket privé (ou absent : le serveur le crée au premier dépôt).
 *
 * Code de sortie 1 si un point bloque la mise en service.
 *
 * Base : par connexion PostgreSQL (DATABASE_URL), ou — si SUPABASE_ACCESS_TOKEN est défini et DATABASE_URL
 * ne l'est pas, ou avec --api — par l'API de gestion de Supabase (HTTPS seulement, utile derrière un pare-feu
 * qui ne laisse passer que le web).
 */
import "./load-env.js";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import process from "node:process";

const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const env = process.env;
const blocking = [];
const warnings = [];
const ok = (message) => console.log(`  ✓ ${message}`);
const fail = (message, fix) => { blocking.push(message); console.log(`  ✗ ${message}${fix ? `\n      → ${fix}` : ""}`); };
const warn = (message, fix) => { warnings.push(message); console.log(`  ⚠ ${message}${fix ? `\n      → ${fix}` : ""}`); };

/** Rôle porté par une clé Supabase « historique » (JWT) ; null pour les nouvelles clés sb_… */
function jwtRole(key) {
  const parts = (key ?? "").split(".");
  if (parts.length !== 3) return null;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")).role ?? null; } catch { return null; }
}

// ─── 1. Variables ────────────────────────────────────────────────────────────────────────────
console.log("\n1. Variables d'environnement");
const supabaseUrl = (env.SUPABASE_URL ?? env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(supabaseUrl)) ok(`SUPABASE_URL : ${supabaseUrl}`);
else fail("SUPABASE_URL absente ou mal formée", "Project Settings → API → Project URL (https://<ref>.supabase.co)");
if (env.EXPO_PUBLIC_SUPABASE_URL && env.SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/+$/, "") !== env.SUPABASE_URL.replace(/\/+$/, "")) {
  fail("EXPO_PUBLIC_SUPABASE_URL et SUPABASE_URL désignent deux projets différents", "les deux doivent être identiques");
}
for (const [name, value, expected] of [["EXPO_PUBLIC_SUPABASE_ANON_KEY", anonKey, "anon"], ["SUPABASE_SERVICE_ROLE_KEY", serviceKey, "service_role"]]) {
  if (!value) { fail(`${name} absente`, "Project Settings → API Keys → onglet « Legacy API keys »"); continue; }
  const role = jwtRole(value);
  if (role === expected) ok(`${name} (rôle ${role})`);
  else if (role) fail(`${name} porte le rôle « ${role} » au lieu de « ${expected} »`, "les deux clés semblent inversées");
  else warn(`${name} n'est pas une clé « Legacy » (JWT)`, "le serveur a été écrit et testé avec les clés « Legacy API keys » (anon / service_role) : utilisez celles-là");
}
if (anonKey && anonKey === serviceKey) fail("clé anon et clé service_role identiques", "la clé service_role ne doit jamais être celle de l'application");

const databaseUrl = env.DATABASE_URL ?? "";
if (!databaseUrl) fail("DATABASE_URL absente", "Project Settings → Database → Connection string → « Transaction pooler »");
else {
  const parsed = (() => { try { return new URL(databaseUrl); } catch { return null; } })();
  if (!parsed || !/^postgres(ql)?:$/.test(parsed.protocol)) fail("DATABASE_URL n'est pas une adresse PostgreSQL");
  else {
    ok(`DATABASE_URL : ${parsed.hostname}:${parsed.port || 5432}`);
    if (parsed.hostname.endsWith("pooler.supabase.com") && parsed.port !== "6543") warn("DATABASE_URL vise le pooler en mode session", "préférer le « Transaction pooler » (port 6543), adapté à un serveur qui ouvre et ferme beaucoup de connexions");
    if (parsed.hostname.endsWith("supabase.com") && !/sslmode=require/.test(parsed.search)) warn("DATABASE_URL sans ?sslmode=require", "ajouter ?sslmode=require à la fin de l'adresse");
  }
}

const secret = (name, legacy) => env[name] || (legacy ? env[legacy] : undefined) || "";
for (const [name, value, why] of [
  ["TIKISSE_SESSION_SECRET", secret("TIKISSE_SESSION_SECRET", "JWT_SECRET"), "signature des sessions"],
  ["TIKISSE_ADMIN_TOTP_KEY", secret("TIKISSE_ADMIN_TOTP_KEY", "TIKIS_ADMIN_TOTP_KEY"), "double authentification de la console"],
  ["CRON_SECRET", secret("CRON_SECRET"), "déclenchement manuel des tâches planifiées"],
]) {
  if (value.length >= 32) ok(`${name} (${why})`);
  else fail(`${name} absent ou trop court (${value.length} caractères, 32 au moins) — ${why}`, `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`);
}
const distinct = new Set([secret("TIKISSE_SESSION_SECRET", "JWT_SECRET"), secret("TIKISSE_ADMIN_TOTP_KEY", "TIKIS_ADMIN_TOTP_KEY"), secret("CRON_SECRET")].filter(Boolean));
if (distinct.size < 3) warn("deux des secrets Tikisse sont identiques", "un secret par usage : la fuite de l'un ne doit pas ouvrir les autres");

if ((env.TIKISSE_OTP_MODE ?? "sim") === "sim") warn("TIKISSE_OTP_MODE=sim : connexion avec le code de simulation", "passer à « real » (et EXPO_PUBLIC_ENABLE_SUPABASE_PHONE_AUTH=true dans l'application) une fois le fournisseur SMS configuré");
else ok("TIKISSE_OTP_MODE=real : vrais SMS");

// ─── 2. Base de données ──────────────────────────────────────────────────────────────────────
console.log("\n2. Base de données");
const projectRef = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(supabaseUrl)?.[1];
const accessToken = env.SUPABASE_ACCESS_TOKEN ?? "";
const viaApi = Boolean(accessToken) && (process.argv.includes("--api") || !databaseUrl);
let runQuery = null;
let closeQuery = async () => {};
if (viaApi) {
  if (!projectRef) fail("API de gestion : SUPABASE_URL nécessaire pour identifier le projet");
  else {
    console.log("  (par l'API de gestion Supabase)");
    runQuery = async (text) => {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: text }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`API de gestion ${response.status} : ${(await response.text()).slice(0, 200)}`);
      return response.json();
    };
  }
} else if (databaseUrl) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, { prepare: false, max: 1, connect_timeout: 10 });
  runQuery = (text) => sql.unsafe(text);
  closeQuery = () => sql.end({ timeout: 2 });
}
if (runQuery) {
  try {
    const journal = JSON.parse(fs.readFileSync(path.join(root, "drizzle/migrations/meta/_journal.json"), "utf8")).entries.length;
    const applied = await runQuery("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations").then((rows) => Number(rows[0]?.n ?? 0)).catch(() => 0);
    if (applied >= journal) ok(`migrations appliquées (${applied}/${journal})`);
    else fail(`migrations : ${applied}/${journal} appliquées`, "elles s'appliquent au déploiement sur Railway ; à la main : pnpm db:migrate");

    const schemaTables = [...fs.readFileSync(path.join(root, "drizzle/schema.ts"), "utf8").matchAll(/pgTable\("([a-z_]+)"/g)].map((m) => m[1]);
    const tables = new Map((await runQuery("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'")).map((row) => [row.tablename, row.rowsecurity]));
    const missing = schemaTables.filter((table) => !tables.has(table));
    const open = schemaTables.filter((table) => tables.has(table) && !tables.get(table));
    if (missing.length) fail(`tables absentes : ${missing.join(", ")}`, "déployer sur Railway (migrations automatiques) ou pnpm db:migrate");
    if (open.length) fail(`RLS désactivée : ${open.join(", ")} — lisibles avec la clé anon de l'application`, "pnpm db:migrate, ou ALTER TABLE … ENABLE ROW LEVEL SECURITY");
    if (!missing.length && !open.length) ok(`${schemaTables.length} tables, RLS activée partout`);

    const anonGrants = await runQuery("SELECT DISTINCT table_name FROM information_schema.role_table_grants WHERE grantee = 'anon' AND table_schema = 'public' AND table_name LIKE 'tikisse_%'").catch(() => []);
    if (anonGrants.length) warn(`le rôle anon garde des droits sur ${anonGrants.length} table(s)`, "sans effet tant que la RLS est active ; pour les retirer : REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon");
    else ok("aucun droit du rôle anon sur les tables Tikisse");

    const realtimeTable = tables.has("tikisse_delivery_channel_members");
    const policies = new Set((await runQuery("SELECT policyname FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages'").catch(() => [])).map((row) => row.policyname));
    const expected = ["Tikisse delivery participants receive broadcasts", "Tikisse assigned driver broadcasts positions", "Tikisse profile receives own wallet broadcasts"];
    const absent = expected.filter((name) => !policies.has(name));
    if (realtimeTable && !absent.length) ok("temps réel : table des participants et 3 règles d'accès en place");
    else fail("temps réel non configuré (supabase/setup.sql pas encore exécuté)", "pnpm supabase:setup, ou Supabase → SQL Editor : coller et exécuter supabase/setup.sql");
    const obsolete = ["tikisse_delivery_members_can_receive_positions", "tikisse_delivery_members_can_send_positions"].filter((name) => policies.has(name));
    if (obsolete.length) warn("anciennes règles temps réel encore présentes", "réexécuter supabase/setup.sql, qui les retire");
  } catch (cause) {
    fail(`base illisible : ${cause instanceof Error ? cause.message : String(cause)}`, viaApi ? "vérifier SUPABASE_ACCESS_TOKEN (Account → Access Tokens)" : "vérifier DATABASE_URL (mot de passe, port 6543, ?sslmode=require)");
  } finally {
    await closeQuery();
  }
} else if (!viaApi) console.log("  (ignoré : ni DATABASE_URL, ni SUPABASE_ACCESS_TOKEN)");

// ─── 3. Supabase Auth ────────────────────────────────────────────────────────────────────────
console.log("\n3. Supabase Auth");
if (supabaseUrl && anonKey) {
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) fail(`réglages Auth illisibles (${response.status})`, "vérifier SUPABASE_URL et la clé anon");
    else {
      const settings = await response.json();
      if (settings.external?.phone) ok("connexion par téléphone activée");
      else fail("connexion par téléphone désactivée — le temps réel ne peut pas ouvrir de session", "Authentication → Sign In / Providers → Phone : activer (fournisseur SMS requis pour les vrais SMS)");
      if (settings.disable_signup) fail("inscriptions désactivées dans Supabase Auth — le serveur ne pourra pas créer les comptes temps réel", "Authentication → Sign In / Providers : autoriser les inscriptions");
      if (settings.external?.email && !settings.external?.phone) warn("seule la connexion par e-mail est active");
    }
  } catch (cause) {
    fail(`Supabase injoignable : ${cause instanceof Error ? cause.message : String(cause)}`);
  }
} else console.log("  (ignoré : SUPABASE_URL ou clé anon absente)");

// ─── 4. Stockage ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Stockage");
if (supabaseUrl && serviceKey) {
  const bucket = env.SUPABASE_STORAGE_BUCKET || "tikisse-files";
  try {
    const response = await fetch(`${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(bucket)}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(10_000) });
    if (response.ok) {
      const found = await response.json();
      if (found.public) fail(`le bucket « ${bucket} » est public : photos et pièces d'identité seraient lisibles par leur adresse`, "Storage → bucket → Edit : décocher « Public bucket »");
      else ok(`bucket « ${bucket} » privé`);
    } else if (response.status === 400 || response.status === 404) ok(`bucket « ${bucket} » absent : le serveur le créera, privé, au premier dépôt`);
    else fail(`stockage illisible (${response.status})`, "vérifier la clé service_role");
  } catch (cause) {
    fail(`stockage injoignable : ${cause instanceof Error ? cause.message : String(cause)}`);
  }
} else console.log("  (ignoré : SUPABASE_URL ou clé service_role absente)");

// ─── Bilan ───────────────────────────────────────────────────────────────────────────────────
console.log("\nÀ vérifier à la main dans le tableau de bord Supabase :");
console.log("  • Realtime → Settings : « Allow public access » DÉSACTIVÉ (seuls les canaux privés existent).");
console.log("  • Authentication → Rate Limits : limite d'envoi de SMS adaptée (chaque SMS est facturé).");
console.log(`\n${blocking.length ? `✗ ${blocking.length} point(s) bloquant(s)` : "✓ Aucun point bloquant"}${warnings.length ? `, ⚠ ${warnings.length} avertissement(s)` : ""}.`);
process.exit(blocking.length ? 1 : 0);
