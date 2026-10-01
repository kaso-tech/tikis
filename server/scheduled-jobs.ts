/**
 * Tâches planifiées, exécutées par le serveur lui-même (plus de console de planification externe).
 *
 *  - Chaque minute, le serveur calcule pour chaque tâche son dernier créneau prévu (heures UTC, l'heure du
 *    Burkina Faso) et tente de le « réserver » en base (tikisse_scheduled_job_runs, unique par tâche et créneau).
 *    Avec plusieurs serveurs, un seul obtient la réservation : la tâche ne tourne qu'une fois.
 *  - Un créneau manqué (serveur arrêté à 3 h) est rattrapé au redémarrage : c'est toujours le dernier créneau
 *    échu qui est visé, et il n'a pas de ligne.
 *  - Une exécution en échec est retentée 15 minutes plus tard, 5 fois au plus ; une exécution restée « en cours »
 *    plus d'une heure (serveur arrêté au milieu) est reprise.
 *
 * Les routes `/api/scheduled/<tâche>` permettent un déclenchement à la main, protégées par CRON_SECRET.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Express, Request } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { tikisseScheduledJobRuns } from "../drizzle/schema";
import { getDb, expireOpenTikisseDeliveries } from "./db";
import { runAccountDeletionJobs } from "./admin-deletions";
import { expireLoyaltyGrants } from "./loyalty";
import { publishDeliveryStatusBroadcast } from "./supabase-realtime";

type Schedule = { everyMinutes: number } | { dailyAt: { hour: number; minute: number } };
type JobOptions = { days?: number };

export type ScheduledJob = {
  name: string;
  description: string;
  schedule: Schedule;
  run: (options: JobOptions) => Promise<Record<string, unknown>>;
};

const RETRY_FAILED_AFTER_MINUTES = 15;
const MAX_ATTEMPTS = 5;
const STALE_RUNNING_AFTER_MINUTES = 60;

export const SCHEDULED_JOBS: ScheduledJob[] = [
  {
    name: "expire-deliveries",
    description: "Clôture les courses actives depuis 24 h, expire celles qui n'ont jamais démarré.",
    schedule: { everyMinutes: 10 },
    run: async () => {
      const result = await expireOpenTikisseDeliveries();
      const occurredAt = new Date().toISOString();
      for (const deliveryId of result.completedDeliveryIds) {
        void publishDeliveryStatusBroadcast({ deliveryId, status: "completed", title: "Livraison finalisée automatiquement", body: "La course active a été clôturée après 24 heures.", occurredAt });
      }
      for (const deliveryId of result.expiredDeliveryIds) {
        void publishDeliveryStatusBroadcast({ deliveryId, status: "expired", title: "Livraison non terminée", body: "La course a expiré avant son démarrage et ses mouvements financiers ont été annulés.", occurredAt });
      }
      return result;
    },
  },
  {
    name: "compute-daily-metrics",
    description: "Recalcule les statistiques des 7 derniers jours (tableau de bord).",
    schedule: { dailyAt: { hour: 0, minute: 15 } },
    run: async ({ days = 7 }) => {
      const { computeRecentMetrics } = await import("./analytics-metrics");
      // Jusqu'à un an en déclenchement manuel : recalculer l'historique après une correction de calcul.
      const capped = Math.min(Math.max(Number.isFinite(days) ? Math.trunc(days) : 7, 1), 366);
      return { days: capped, metrics: await computeRecentMetrics(capped) };
    },
  },
  {
    name: "finalize-account-deletions",
    description: "Supprime les comptes arrivés au bout des 30 jours, efface leurs fichiers, purge à 10 ans.",
    schedule: { dailyAt: { hour: 3, minute: 0 } },
    run: () => runAccountDeletionJobs(),
  },
  {
    name: "expire-loyalty-grants",
    description: "Annule les bonus de fidélité non crédités dont l'échéance est passée.",
    schedule: { dailyAt: { hour: 4, minute: 0 } },
    run: () => expireLoyaltyGrants(),
  },
];

/** Dernier créneau prévu à `now` ou avant (UTC). */
export function latestSlot(schedule: Schedule, now: Date): Date {
  if ("everyMinutes" in schedule) {
    const step = schedule.everyMinutes * 60_000;
    return new Date(Math.floor(now.getTime() / step) * step);
  }
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), schedule.dailyAt.hour, schedule.dailyAt.minute));
  if (slot > now) slot.setUTCDate(slot.getUTCDate() - 1);
  return slot;
}

/**
 * Réserve un créneau. Renvoie l'identifiant de l'exécution, ou null si un autre serveur l'a déjà (ou s'il est
 * déjà fait). La condition de reprise est évaluée par la base, dans la même instruction : deux serveurs ne
 * peuvent pas reprendre ensemble la même exécution en échec.
 */
async function claim(jobName: string, slot: string, trigger: "schedule" | "manual"): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.insert(tikisseScheduledJobRuns)
    .values({ id: randomUUID(), jobName, slot, trigger })
    .onConflictDoUpdate({
      target: [tikisseScheduledJobRuns.jobName, tikisseScheduledJobRuns.slot],
      set: { status: "running", attempts: sql`${tikisseScheduledJobRuns.attempts} + 1`, startedAt: new Date(), finishedAt: null, error: null },
      setWhere: sql`(${tikisseScheduledJobRuns.status} = 'failed'
          AND ${tikisseScheduledJobRuns.finishedAt} < now() - make_interval(mins => ${RETRY_FAILED_AFTER_MINUTES})
          AND ${tikisseScheduledJobRuns.attempts} < ${MAX_ATTEMPTS})
        OR (${tikisseScheduledJobRuns.status} = 'running'
          AND ${tikisseScheduledJobRuns.startedAt} < now() - make_interval(mins => ${STALE_RUNNING_AFTER_MINUTES}))`,
    })
    .returning({ id: tikisseScheduledJobRuns.id });
  return rows[0]?.id ?? null;
}

async function finish(runId: string, outcome: { result?: Record<string, unknown>; error?: string }) {
  const db = await getDb();
  if (!db) return;
  await db.update(tikisseScheduledJobRuns).set({
    status: outcome.error ? "failed" : "succeeded",
    finishedAt: new Date(),
    result: outcome.result ? JSON.stringify(outcome.result).slice(0, 4000) : null,
    error: outcome.error?.slice(0, 500) ?? null,
  }).where(eq(tikisseScheduledJobRuns.id, runId));
}

async function execute(job: ScheduledJob, runId: string, options: JobOptions) {
  try {
    const result = await job.run(options);
    await finish(runId, { result });
    return { ok: true as const, result };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    console.error(`[scheduled:${job.name}]`, cause);
    await finish(runId, { error }).catch(() => {});
    return { ok: false as const, error };
  }
}

/** Un passage du planificateur : chaque tâche dont le créneau échu n'a pas encore tourné est exécutée. */
export async function runDueJobs(now = new Date(), jobs: ScheduledJob[] = SCHEDULED_JOBS) {
  const ran: string[] = [];
  for (const job of jobs) {
    const slot = latestSlot(job.schedule, now).toISOString();
    const runId = await claim(job.name, slot, "schedule");
    if (!runId) continue;
    await execute(job, runId, {});
    ran.push(job.name);
  }
  return ran;
}

/** Déclenchement à la main (route protégée) : toujours exécuté, inscrit à part dans l'historique. */
export async function runJobNow(name: string, options: JobOptions = {}, jobs: ScheduledJob[] = SCHEDULED_JOBS) {
  const job = jobs.find((candidate) => candidate.name === name);
  if (!job) return null;
  const runId = await claim(job.name, `manual:${randomUUID()}`, "manual");
  if (!runId) throw new Error("La base est indisponible : la tâche n’a pas pu être lancée.");
  return execute(job, runId, options);
}

export async function lastJobRuns(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(tikisseScheduledJobRuns).orderBy(desc(tikisseScheduledJobRuns.startedAt)).limit(Math.min(limit, 200));
}

export async function lastSuccessfulRun(jobName: string) {
  const db = await getDb();
  if (!db) return undefined;
  return (await db.select().from(tikisseScheduledJobRuns)
    .where(and(eq(tikisseScheduledJobRuns.jobName, jobName), eq(tikisseScheduledJobRuns.status, "succeeded")))
    .orderBy(desc(tikisseScheduledJobRuns.startedAt)).limit(1))[0];
}

/**
 * Démarre le planificateur : un passage par minute, jamais deux en même temps dans un même serveur.
 * Désactivable par TIKISSE_SCHEDULER=off (par exemple sur une instance de secours).
 */
export function startScheduler(options: { intervalMs?: number; firstRunDelayMs?: number } = {}) {
  if (process.env.TIKISSE_SCHEDULER === "off") {
    console.log("[scheduler] désactivé (TIKISSE_SCHEDULER=off)");
    return () => {};
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const ran = await runDueJobs();
      if (ran.length) console.log(`[scheduler] exécuté : ${ran.join(", ")}`);
    } catch (cause) {
      console.error("[scheduler] passage impossible", cause);
    } finally {
      busy = false;
    }
  };
  const first = setTimeout(() => void tick(), options.firstRunDelayMs ?? 20_000);
  const interval = setInterval(() => void tick(), options.intervalMs ?? 60_000);
  first.unref();
  interval.unref();
  return () => {
    clearTimeout(first);
    clearInterval(interval);
  };
}

/** Le secret attendu, comparé en temps constant. */
export function isAuthorizedCronRequest(authorization: string | undefined, secret = process.env.CRON_SECRET) {
  if (!secret || secret.length < 32 || !authorization?.startsWith("Bearer ")) return false;
  const given = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /api/scheduled/<tâche> : déclenchement à la main ou par un planificateur externe, avec
 * `Authorization: Bearer <CRON_SECRET>`. Sans CRON_SECRET (32 caractères au moins), les routes répondent 503.
 */
export function registerScheduledRoutes(app: Express, jobs: ScheduledJob[] = SCHEDULED_JOBS) {
  for (const job of jobs) {
    app.post(`/api/scheduled/${job.name}`, async (req: Request, res) => {
      if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
        return res.status(503).json({ error: "Déclenchement manuel désactivé : définissez CRON_SECRET (32 caractères au moins)." });
      }
      if (!isAuthorizedCronRequest(req.headers.authorization)) return res.status(403).json({ error: "cron-only" });
      const days = req.query?.days !== undefined ? Number(req.query.days) : undefined;
      try {
        const outcome = await runJobNow(job.name, { days }, jobs);
        if (!outcome) return res.status(404).json({ error: "Tâche inconnue." });
        return outcome.ok ? res.json({ ok: true, ...outcome.result }) : res.status(500).json({ error: outcome.error });
      } catch (cause) {
        return res.status(503).json({ error: cause instanceof Error ? cause.message : "Base indisponible." });
      }
    });
  }
}
