#!/usr/bin/env node
/**
 * pnpm db:check-schema
 *
 * Vérifie la cohérence entre :
 *  - les tables définies dans drizzle/schema.ts
 *  - les fichiers de migration drizzle/manual/*.sql et les migrations générées
 *  - les tables réellement présentes en base (optionnel, via DATABASE_URL)
 *
 * Sans DATABASE_URL, le script fait un check statique (rapide, safe en CI).
 * Avec DATABASE_URL, il ajoute un check de présence en base.
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
const manualDir = path.join(root, "drizzle", "manual");
const metaJournal = path.join(root, "drizzle", "meta", "_journal.json");

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
const tableMatches = schemaText.matchAll(/mysqlTable\(\s*["']([^"']+)["']/g);
const tablesInSchema = new Set();
for (const match of tableMatches) {
  tablesInSchema.add(match[1]);
}

console.log(`Tables définies dans drizzle/schema.ts : ${tablesInSchema.size}`);
for (const table of [...tablesInSchema].sort()) {
  console.log(`  • ${table}`);
}

const manualMigrations = fs.existsSync(manualDir) ? fs.readdirSync(manualDir).filter((f) => f.endsWith(".sql")).sort() : [];
console.log(`\nMigrations manuelles : ${manualMigrations.length}`);
const tableRefsInManual = new Set();
for (const file of manualMigrations) {
  const sql = fs.readFileSync(path.join(manualDir, file), "utf8");
  const matches = sql.matchAll(/(?:CREATE TABLE|ALTER TABLE|DROP TABLE)\s+(?:IF NOT EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/g);
  for (const match of matches) {
    tableRefsInManual.add(match[1]);
  }
}

const tablesWithoutMigration = [...tablesInSchema].filter((table) => !tableRefsInManual.has(table));
if (tablesWithoutMigration.length > 0) {
  const drizzleDir = path.join(root, "drizzle");
  const drizzleSqlFiles = fs.existsSync(drizzleDir) ? fs.readdirSync(drizzleDir).filter((f) => /^\d{4}_.+\.sql$/.test(f)) : [];
  const drizzleTableRefs = new Set();
  for (const file of drizzleSqlFiles) {
    const sql = fs.readFileSync(path.join(drizzleDir, file), "utf8");
    const matches = sql.matchAll(/(?:CREATE TABLE|ALTER TABLE)\s+(?:IF NOT EXISTS\s+)?`?([a-zA-Z_][a-zA-Z0-9_]*)`?/g);
    for (const match of matches) {
      drizzleTableRefs.add(match[1]);
    }
  }
  const stillOrphan = tablesWithoutMigration.filter((t) => !drizzleTableRefs.has(t));
  if (stillOrphan.length > 0) {
    for (const table of stillOrphan) {
      logIssue(`Table '${table}' présente dans schema.ts mais absente des migrations (manual/ et drizzle/).`);
    }
  } else {
    logOk(`Toutes les tables du schema sont couvertes par ${manualMigrations.length} migration(s) manuelle(s) + ${drizzleSqlFiles.length} migration(s) drizzle.`);
  }
} else {
  logOk("Toutes les tables du schema sont référencées dans au moins une migration manuelle.");
}

let journalMigrations = [];
if (fs.existsSync(metaJournal)) {
  const journal = JSON.parse(fs.readFileSync(metaJournal, "utf8"));
  journalMigrations = (journal.entries ?? []).map((entry) => entry.when).sort();
  console.log(`\nMigrations générées (drizzle-kit) : ${journalMigrations.length}`);
} else {
  console.warn(`\nFichier meta/_journal.json introuvable — vérifie que 'drizzle-kit generate' a déjà été lancé.`);
}

if (manualMigrations.length > 0 && journalMigrations.length > 0) {
  const manualPrefixes = new Set(manualMigrations.map((f) => f.split("_")[0]));
  const missingInDrizzleKit = [...manualPrefixes].filter((prefix) => !journalMigrations.includes(Number(prefix)));
  if (missingInDrizzleKit.length > 0) {
    console.log(`  ℹ Migrations manuelles (${missingInDrizzleKit.join(", ")}) non couvertes par drizzle-kit. C'est attendu : elles sont appliquées manuellement (cf. docs/OPERATIONS.md).`);
  } else {
    logOk("Toutes les migrations manuelles sont alignées avec le journal drizzle-kit.");
  }
}

const minConstraints = schemaText.match(/\.min\(\s*(\d+)/g) || [];
const maxConstraints = schemaText.match(/\.max\(\s*(\d+)/g) || [];
console.log(`\nContraintes détectées : ${minConstraints.length} min() + ${maxConstraints.length} max()`);

if (process.env.DATABASE_URL) {
  console.log("\nDATABASE_URL détectée : check live (SELECT table_name)…");
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    const [rows] = await conn.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()");
    const tablesInDb = new Set(rows.map((r) => r.TABLE_NAME || r.table_name));
    const missingInDb = [...tablesInSchema].filter((t) => !tablesInDb.has(t));
    if (missingInDb.length > 0) {
      for (const t of missingInDb) logIssue(`Table '${t}' absente en base — applique les migrations.`);
    } else {
      logOk(`Toutes les ${tablesInSchema.size} tables sont présentes en base.`);
    }
    const orphanInDb = [...tablesInDb].filter((t) => t.startsWith("tikis_") && !tablesInSchema.has(t));
    if (orphanInDb.length > 0) {
      console.warn(`\n  ℹ Tables 'tikis_*' en base mais pas dans schema.ts :`);
      for (const t of orphanInDb) console.warn(`      • ${t}`);
    }
    await conn.end();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    logIssue(`Échec du check live : ${message}`);
  }
} else {
  console.log("\nDATABASE_URL non définie : check statique uniquement (set DATABASE_URL pour un check live).");
}

if (issues.length > 0) {
  console.error(`\n${issues.length} problème(s) détecté(s).`);
  process.exit(1);
}
console.log("\nAucun problème détecté.");
