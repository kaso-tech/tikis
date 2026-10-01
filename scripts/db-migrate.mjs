#!/usr/bin/env node
/**
 * Applique les migrations de drizzle/migrations à la base (DATABASE_MIGRATION_URL, sinon DATABASE_URL).
 *
 * Exécuté par Render avant chaque mise en service (render.yaml → preDeployCommand) : si une migration
 * échoue, la nouvelle version n'est pas mise en ligne et l'ancienne continue de tourner. Ne rejoue que ce qui
 * manque (journal drizzle.__drizzle_migrations), sans risque à chaque déploiement.
 *
 * Utilise uniquement des dépendances d'exécution (drizzle-orm, postgres), pas drizzle-kit.
 * DATABASE_MIGRATION_URL : de préférence l'adresse « Session pooler » de Supabase (port 5432), mieux adaptée
 * aux changements de structure que le « Transaction pooler » utilisé par le serveur.
 */
import "./load-env.js";
import path from "node:path";
import url from "node:url";
import process from "node:process";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const connectionString = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("[migrate] DATABASE_MIGRATION_URL ou DATABASE_URL requis.");
  process.exit(1);
}
// Adresse illisible (souvent un mot de passe avec # / ? @ :) : le dire sans l'afficher, car postgres
// recopierait l'adresse entière, mot de passe compris, dans les journaux.
try {
  const parsed = new URL(connectionString);
  if (!/^postgres(ql)?:$/.test(parsed.protocol) || !parsed.hostname) throw new Error("adresse incomplète");
} catch {
  console.error("[migrate] adresse de la base invalide (DATABASE_MIGRATION_URL ou DATABASE_URL). Le mot de passe contient sans doute un caractère réservé (# / ? @ : %) : le réinitialiser dans Supabase avec des lettres et des chiffres seulement, ou l'encoder (encodeURIComponent).");
  process.exit(1);
}
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const client = postgres(connectionString, { prepare: false, max: 1, connect_timeout: 15, onnotice: () => {} });
const started = Date.now();
try {
  await migrate(drizzle(client), { migrationsFolder: path.join(root, "drizzle/migrations") });
  const [{ count }] = await client`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`;
  console.log(`[migrate] base à jour : ${count} migration(s) appliquée(s) au total (${Date.now() - started} ms).`);
} catch (cause) {
  const reason = cause?.cause?.message ?? (cause instanceof Error ? cause.message : String(cause));
  console.error(`[migrate] échec — la nouvelle version ne doit pas être mise en ligne : ${reason}`);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}
