#!/usr/bin/env node
/**
 * pnpm db:audit-fk
 *
 * Audite les foreign keys du schema Drizzle par rapport aux relations métier connues.
 * Drizzle ne déclare pas les FK de manière déclarative (cf. D4 audit) — ce script
 * aide à repérer les colonnes qui DEVRAIENT être des FK et à diagnostiquer les orphelins.
 *
 * Sans DATABASE_URL : check statique (rapide).
 * Avec DATABASE_URL : check live (détection des orphelins).
 *
 * Exit code 0 = OK, 1 = orphelins détectés (si check live).
 */

import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const schemaPath = path.join(root, "drizzle", "schema.ts");

if (!fs.existsSync(schemaPath)) {
  console.error("Fichier manquant :", schemaPath);
  process.exit(1);
}

const schemaText = fs.readFileSync(schemaPath, "utf8");

const tableMatches = [...schemaText.matchAll(/mysqlTable\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
const tables = new Set(tableMatches);

const expectedRelations = [
  { child: "tikis_deliveries", childCol: "senderPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Une livraison doit avoir un expéditeur connu." },
  { child: "tikis_deliveries", childCol: "driverPhone", parent: "tikis_profiles", parentCol: "phone", required: false, note: "driverPhone peut être null (course open sans candidat sélectionné)." },
  { child: "tikis_delivery_candidates", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: true, note: "Candidature liée à une livraison existante." },
  { child: "tikis_delivery_candidates", childCol: "driverPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Candidature d'un livreur connu." },
  { child: "tikis_delivery_live_locations", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: true, note: "Position liée à une livraison." },
  { child: "tikis_delivery_live_locations", childCol: "driverPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Position d'un livreur connu." },
  { child: "tikis_delivery_events", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: true, note: "Event lié à une livraison." },
  { child: "tikis_delivery_reports", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: true, note: "Signalement lié à une livraison." },
  { child: "tikis_delivery_reports", childCol: "reporterPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Signalement par un profil connu." },
  { child: "tikis_delivery_reviews", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: true, note: "Avis lié à une livraison." },
  { child: "tikis_delivery_reviews", childCol: "reviewerPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Avis émis par un profil connu." },
  { child: "tikis_delivery_reviews", childCol: "driverPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Avis sur un livreur connu." },
  { child: "tikis_kyc_submissions", childCol: "driverPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Dossier KYC d'un livreur connu." },
  { child: "tikis_wallets", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Wallet d'un profil connu." },
  { child: "tikis_wallet_ledger", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Mouvement de wallet d'un profil connu." },
  { child: "tikis_referrals", childCol: "referrerPhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Parrain connu." },
  { child: "tikis_referrals", childCol: "refereePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Filleul connu." },
  { child: "tikis_favorite_places", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Adresse favorite d'un profil connu." },
  { child: "tikis_payment_transactions", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Transaction d'un profil connu." },
  { child: "tikis_payment_transactions", childCol: "deliveryId", parent: "tikis_deliveries", parentCol: "id", required: false, note: "Transaction peut être un dépôt sans livraison." },
  { child: "tikis_push_tokens", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Push token d'un profil connu." },
  { child: "tikis_profile_sessions", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Session d'un profil connu." },
  { child: "tikis_loyalty_grants", childCol: "profilePhone", parent: "tikis_profiles", parentCol: "phone", required: true, note: "Octroi de bonus d'un profil connu." },
  { child: "tikis_admin_audit_log", childCol: "adminId", parent: "tikis_admin_users", parentCol: "id", required: true, note: "Action tracée d'un admin connu." },
];

console.log(`\nAudit des foreign keys — ${expectedRelations.length} relations attendues\n`);

const present = expectedRelations.filter((r) => tables.has(r.child) && tables.has(r.parent));
const obsolete = expectedRelations.filter((r) => !tables.has(r.child) || !tables.has(r.parent));

console.log(`  ✓ ${present.length} relations pertinentes (tables enfant + parent présentes)`);
if (obsolete.length > 0) {
  console.log(`  ℹ ${obsolete.length} relations obsolètes (table absente du schema) :`);
  for (const rel of obsolete) {
    console.log(`      • ${rel.child}.${rel.childCol} → ${rel.parent}.${rel.parentCol}`);
  }
}

console.log(`\nFK déclarées dans schema.ts : 0 (cf. D4 audit — choix volontaire, la cohérence est gérée par la logique métier + cache).`);

const liveIssues = [];

if (process.env.DATABASE_URL) {
  console.log("\nDATABASE_URL détectée : détection des orphelins…");
  try {
    const mysql = await import("mysql2/promise");
    const conn = await mysql.createConnection(process.env.DATABASE_URL);
    for (const rel of present) {
      const query = `SELECT COUNT(*) AS orphans FROM \`${rel.child}\` c LEFT JOIN \`${rel.parent}\` p ON c.\`${rel.childCol}\` = p.\`${rel.parentCol}\` WHERE p.\`${rel.parentCol}\` IS NULL${rel.required ? "" : ` AND c.\`${rel.childCol}\` IS NOT NULL`}`;
      const [rows] = await conn.query(query);
      const orphans = Number(rows[0]?.orphans ?? 0);
      if (orphans > 0) {
        liveIssues.push(`  ✗ ${rel.child}.${rel.childCol} → ${rel.parent}.${rel.parentCol} : ${orphans} orphelin(s)`);
      } else {
        console.log(`  ✓ ${rel.child}.${rel.childCol} : aucun orphelin`);
      }
    }
    await conn.end();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error(`\nErreur live : ${message}`);
    process.exit(1);
  }
} else {
  console.log("\nDATABASE_URL non définie : set-la pour détecter les orphelins en base.");
}

if (liveIssues.length > 0) {
  console.error(`\n${liveIssues.length} problème(s) d'orphelins :`);
  for (const issue of liveIssues) console.error(issue);
  process.exit(1);
}

console.log("\nAudit terminé.");
