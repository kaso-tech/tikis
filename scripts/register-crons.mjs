#!/usr/bin/env node
/**
 * pnpm cron:register-all
 *
 * Affiche la liste des crons à enregistrer via la console webdevtoken.v1.WebDevService.
 * Vérifie que chaque endpoint répond en HTTP 200 (optionnel via --ping).
 *
 * Crons Tikis :
 *   - expire-deliveries         toutes les 10 minutes  (finalise les courses actives > 24h)
 *   - finalize-account-deletions 1 fois par jour        (supprime les comptes en attente > 30j)
 *   - expire-loyalty-grants      1 fois par jour        (annule les grants loyalty non crédités > 30j)
 *
 * Usage :
 *   pnpm cron:register-all            # affiche la liste + instructions
 *   pnpm cron:register-all --ping     # vérifie en local que les endpoints sont OK
 *
 * Note : l'enregistrement effectif se fait via la console webdevtoken (UI),
 *        ce script ne fait qu'aider l'opérateur à ne rien oublier.
 */

import process from "node:process";

const CRONS = [
  {
    name: "expire-deliveries",
    path: "/api/scheduled/expire-deliveries",
    schedule: "*/10 * * * *",
    description: "Finalise les livraisons actives depuis plus de 24h et notifie les parties.",
  },
  {
    name: "finalize-account-deletions",
    path: "/api/scheduled/finalize-account-deletions",
    schedule: "0 3 * * *",
    description: "Supprime définitivement les comptes dont deletionScheduledAt est dépassé (>30j).",
  },
  {
    name: "expire-loyalty-grants",
    path: "/api/scheduled/expire-loyalty-grants",
    schedule: "0 4 * * *",
    description: "Annule les loyalty grants pending dont expiresAt est dépassé (>30j).",
  },
  {
    name: "compute-daily-metrics",
    path: "/api/scheduled/compute-daily-metrics?days=7",
    schedule: "15 0 * * *",
    description: "Calcule les métriques business des 7 derniers jours (GMV, commission, courses) et les upsert dans tikis_daily_metrics.",
  },
];

const args = new Set(process.argv.slice(2));
const shouldPing = args.has("--ping");
const baseUrl = process.env.TIKIS_API_URL ?? "http://localhost:3000";

function printInstructions() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║              Tikis — Cron registration helper                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");
  console.log("Les 3 crons suivants doivent être enregistrés dans la console webdevtoken :\n");
  for (const cron of CRONS) {
    console.log(`  • ${cron.name.padEnd(28)} ${cron.schedule.padEnd(15)} → ${baseUrl}${cron.path}`);
    console.log(`    ${cron.description}\n`);
  }
  console.log("Enregistrement (UI webdevtoken.v1.WebDevService) :");
  console.log("  1. Ouvrir la console d'administration webdevtoken");
  console.log("  2. Section 'Scheduled jobs' → 'Register'");
  console.log("  3. Pour chaque cron ci-dessus, copier :");
  console.log("     - URL       = baseUrl + path");
  console.log("     - Schedule  = la cron expression");
  console.log("     - Auth      = isCron=true (token de service généré par webdevtoken)\n");
  console.log("Astuce : un healthcheck global existe sur /api/health (GET).");
}

async function ping() {
  console.log(`Ping des endpoints sur ${baseUrl}…\n`);
  for (const cron of CRONS) {
    const url = `${baseUrl}${cron.path}`;
    const startedAt = Date.now();
    try {
      const response = await fetch(url, { method: "POST" });
      const latencyMs = Date.now() - startedAt;
      if (response.status === 403) {
        console.log(`  ✓ ${cron.name.padEnd(28)} → 403 (cron-only, comportement attendu sans token)`);
      } else if (response.status === 200) {
        console.log(`  ✓ ${cron.name.padEnd(28)} → 200 OK (${latencyMs} ms)`);
      } else {
        console.log(`  ✗ ${cron.name.padEnd(28)} → ${response.status} inattendu`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.log(`  ✗ ${cron.name.padEnd(28)} → erreur : ${message}`);
    }
  }
}

if (shouldPing) {
  await ping();
} else {
  printInstructions();
}
