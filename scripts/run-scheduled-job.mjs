#!/usr/bin/env node
/**
 * pnpm jobs:run <tâche> [--days=N]
 *
 * Déclenche à la main une tâche planifiée sur un serveur Tikisse en marche. En temps normal, rien à faire :
 * le serveur les exécute lui-même (server/scheduled-jobs.ts). Utile après un incident, ou pour vérifier.
 *
 * Variables : TIKISSE_API_URL (ex. https://api.tikisse.app, défaut http://localhost:3000) et CRON_SECRET
 * (le même que celui du serveur).
 *
 * Tâches : expire-deliveries, compute-daily-metrics, finalize-account-deletions, expire-loyalty-grants
 */
import process from "node:process";

const JOBS = ["expire-deliveries", "compute-daily-metrics", "finalize-account-deletions", "expire-loyalty-grants"];
const [job, ...flags] = process.argv.slice(2);
if (!job || !JOBS.includes(job)) {
  console.error(`Usage : pnpm jobs:run <${JOBS.join("|")}> [--days=N]`);
  process.exit(1);
}
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET manquant (le même que celui du serveur).");
  process.exit(1);
}
const base = (process.env.TIKISSE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const days = flags.find((flag) => flag.startsWith("--days="))?.slice("--days=".length);
const url = `${base}/api/scheduled/${job}${days ? `?days=${encodeURIComponent(days)}` : ""}`;

const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
const body = await response.text();
console.log(`${response.status} ${url}`);
console.log(body);
process.exit(response.ok ? 0 : 1);
