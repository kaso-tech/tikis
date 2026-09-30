#!/usr/bin/env node
/**
 * pnpm db:check-schema
 *
 * Vérifie la cohérence entre :
 *  - les tables définies dans drizzle/schema.ts
 *  - les migrations PostgreSQL de drizzle/migrations (création, et RLS activée : sans elle, l'API publique
 *    de Supabase lirait la table avec la clé « anon » embarquée dans l'application)
 *  - la base elle-même (optionnel, via DATABASE_URL) : tables présentes, RLS activée
 *
 * Sans DATABASE_URL, le script fait un check statique (rapide, safe en CI).
 *
 * Exit code 0 = OK, 1 = problème détecté.
 */

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const schemaPath = path.join(root, "drizzle", "schema.ts");
const migrationsDir = path.join(root, "drizzle", "migrations");

const issues = [];

function logIssue(message) {
  issues.push(message);
  console.error("  ✗", message);
}

function logOk(message) {
  console.log("  ✓", message);
}

if (!fs.existsSync(schemaPath)) {
  console.error("Fichier manquant :", schemaPath);
  process.exit(1);
}

const schemaText = fs.readFileSync(schemaPath, "utf8");
const tablesInSchema = new Set([...schemaText.matchAll(/pgTable\(\s*["']([^"']+)["']/g)].map((match) => match[1]));

console.log(`Tables définies dans drizzle/schema.ts : ${tablesInSchema.size}`);
for (const table of [...tablesInSchema].sort()) console.log(`  • ${table}`);

const migrations = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort() : [];
console.log(`\nMigrations PostgreSQL : ${migrations.length}`);
const created = new Set();
const secured = new Set();
for (const file of migrations) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
  for (const match of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/g)) created.add(match[1]);
  for (const match of sql.matchAll(/ALTER TABLE\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s+ENABLE ROW LEVEL SECURITY/g)) secured.add(match[1]);
}

const notCreated = [...tablesInSchema].filter((table) => !created.has(table));
for (const table of notCreated) logIssue(`Table '${table}' présente dans schema.ts mais créée par aucune migration — lance 'pnpm db:generate'.`);
if (notCreated.length === 0) logOk(`Toutes les tables du schéma sont créées par les migrations.`);

const notSecured = [...tablesInSchema].filter((table) => !secured.has(table));
for (const table of notSecured) logIssue(`Table '${table}' sans 'ENABLE ROW LEVEL SECURITY' dans les migrations : elle serait lisible par l'API publique de Supabase.`);
if (notSecured.length === 0) logOk(`RLS activée par les migrations sur toutes les tables.`);

if (process.env.DATABASE_URL) {
  console.log("\nDATABASE_URL détectée : check live…");
  const { default: postgres } = await import("postgres");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const rows = await sql`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`;
    const inDb = new Map(rows.map((row) => [row.tablename, row.rowsecurity]));
    const missing = [...tablesInSchema].filter((table) => !inDb.has(table));
    for (const table of missing) logIssue(`Table '${table}' absente en base — applique les migrations ('pnpm db:migrate').`);
    if (missing.length === 0) logOk(`Toutes les ${tablesInSchema.size} tables sont présentes en base.`);
    const open = [...tablesInSchema].filter((table) => inDb.has(table) && !inDb.get(table));
    for (const table of open) logIssue(`Table '${table}' sans RLS en base : lisible par l'API publique de Supabase.`);
    if (missing.length === 0 && open.length === 0) logOk("RLS activée en base sur toutes les tables.");
    const orphans = [...inDb.keys()].filter((table) => table.startsWith("tikisse_") && !tablesInSchema.has(table) && table !== "tikisse_delivery_channel_members");
    if (orphans.length > 0) {
      console.warn(`\n  ℹ Tables 'tikisse_*' en base mais pas dans schema.ts :`);
      for (const table of orphans) console.warn(`      • ${table}`);
    }
  } catch (cause) {
    logIssue(`Échec du check live : ${cause instanceof Error ? cause.message : String(cause)}`);
  } finally {
    await sql.end();
  }
} else {
  console.log("\nDATABASE_URL non définie : check statique uniquement (set DATABASE_URL pour un check live).");
}

if (issues.length > 0) {
  console.error(`\n${issues.length} problème(s) détecté(s).`);
  process.exit(1);
}
console.log("\nAucun problème détecté.");
