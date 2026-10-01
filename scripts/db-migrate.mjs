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
// Adresse illisible : dire précisément pourquoi, sans jamais l'afficher — postgres recopierait l'adresse
// entière, mot de passe compris, dans les journaux.
const variable = process.env.DATABASE_MIGRATION_URL ? "DATABASE_MIGRATION_URL" : "DATABASE_URL";
const problem = describeUrlProblem(connectionString);
if (problem) {
  console.error(`[migrate] ${variable} invalide : ${problem}`);
  console.error("[migrate] Format attendu : postgresql://postgres.<ref>:<mot de passe>@<hôte>.pooler.supabase.com:5432/postgres?sslmode=require");
  process.exit(1);
}

/** Cause d'une adresse inutilisable, sans rien en citer de secret ; null si elle est lisible. */
function describeUrlProblem(value) {
  if (value !== value.trim()) return "espace ou retour à la ligne au début ou à la fin de la valeur — les retirer.";
  if (/^["']|["']$/.test(value)) return "la valeur est entourée de guillemets — les retirer (Render n'en veut pas).";
  if (/^[A-Z_]+=/.test(value)) return "la valeur commence par « NOM= » — ne coller que l'adresse, à partir de postgresql://.";
  if (!/^postgres(ql)?:\/\//.test(value)) return "la valeur ne commence pas par postgresql:// .";
  if (/[\[\]]/.test(value)) return "crochets [ ] présents — ceux de l'exemple Supabase autour du mot de passe sont à retirer.";
  if (/\s/.test(value)) return "espace à l'intérieur de l'adresse.";
  const credentials = value.slice(value.indexOf("//") + 2, value.lastIndexOf("@"));
  if (value.lastIndexOf("@") < 0) return "pas de « @ » : identifiant et mot de passe manquants.";
  if ((value.match(/@/g) ?? []).length > 1) return "plusieurs « @ » : le mot de passe en contient un — l'encoder (%40) ou le changer.";
  if (/[#/?]/.test(credentials)) return "le mot de passe contient # / ou ? — l'encoder ou le changer (lettres et chiffres).";
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return "hôte manquant après « @ ».";
    if (!parsed.port) return "port manquant (5432 pour DATABASE_MIGRATION_URL, 6543 pour DATABASE_URL).";
  } catch {
    return "adresse illisible (caractère inattendu).";
  }
  return null;
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
