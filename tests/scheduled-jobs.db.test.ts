/**
 * Planificateur intégré (server/scheduled-jobs.ts), contre une vraie base PostgreSQL, avec des tâches factices :
 * une exécution par créneau même à plusieurs serveurs, reprise après échec, rattrapage, déclenchement manuel.
 *
 *   TIKISSE_TEST_DATABASE_URL=<url> npx vitest run tests/scheduled-jobs.db.test.ts
 */
import express from "express";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isAuthorizedCronRequest, latestSlot, type ScheduledJob } from "../server/scheduled-jobs";

const TEST_DB = process.env.TIKISSE_TEST_DATABASE_URL;
if (TEST_DB) process.env.DATABASE_URL = TEST_DB;

let jobs: typeof import("../server/scheduled-jobs");
let db: typeof import("../server/db");
let schema: typeof import("../drizzle/schema");
let orm: typeof import("drizzle-orm");

beforeAll(async () => {
  if (!TEST_DB) return;
  jobs = await import("../server/scheduled-jobs");
  db = await import("../server/db");
  schema = await import("../drizzle/schema");
  orm = await import("drizzle-orm");
});

function fakeJob(schedule: ScheduledJob["schedule"], run: ScheduledJob["run"] = async () => ({ done: true })): ScheduledJob & { calls: number } {
  const job = { name: `test-${randomUUID().slice(0, 8)}`, description: "test", schedule, calls: 0, run: async (options: { days?: number }) => { job.calls += 1; return run(options); } };
  return job;
}

async function runsOf(name: string) {
  const handle = (await db.getDb())!;
  return handle.select().from(schema.tikisseScheduledJobRuns).where(orm.eq(schema.tikisseScheduledJobRuns.jobName, name));
}

describe("créneaux (UTC)", () => {
  it("toutes les 10 minutes : le dernier multiple de 10 échu", () => {
    expect(latestSlot({ everyMinutes: 10 }, new Date("2026-10-01T10:27:41Z")).toISOString()).toBe("2026-10-01T10:20:00.000Z");
  });

  it("chaque jour à 3 h : celui du jour s'il est passé, sinon celui de la veille (rattrapage)", () => {
    expect(latestSlot({ dailyAt: { hour: 3, minute: 0 } }, new Date("2026-10-01T10:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(latestSlot({ dailyAt: { hour: 3, minute: 0 } }, new Date("2026-10-01T02:59:00Z")).toISOString()).toBe("2026-09-30T03:00:00.000Z");
  });
});

describe("secret de déclenchement manuel", () => {
  const secret = "s".repeat(40);
  it("exige le secret exact, de 32 caractères au moins", () => {
    expect(isAuthorizedCronRequest(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCronRequest(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCronRequest(secret, secret)).toBe(false);
    expect(isAuthorizedCronRequest(undefined, secret)).toBe(false);
    expect(isAuthorizedCronRequest("Bearer court", "court")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer ", undefined)).toBe(false);
  });
});

describe.skipIf(!TEST_DB)("planificateur sous PostgreSQL", () => {
  it("un créneau ne tourne qu'une fois, même lancé par trois serveurs en même temps", async () => {
    const job = fakeJob({ everyMinutes: 10 });
    const now = new Date("2026-10-01T10:27:00Z");
    await Promise.all([jobs.runDueJobs(now, [job]), jobs.runDueJobs(now, [job]), jobs.runDueJobs(now, [job])]);
    await jobs.runDueJobs(new Date("2026-10-01T10:29:00Z"), [job]);
    expect(job.calls).toBe(1);
    const [run] = await runsOf(job.name);
    expect(run).toMatchObject({ slot: "2026-10-01T10:20:00.000Z", status: "succeeded", trigger: "schedule", result: JSON.stringify({ done: true }) });
    await jobs.runDueJobs(new Date("2026-10-01T10:30:00Z"), [job]);
    expect(job.calls).toBe(2);
  });

  it("une tâche quotidienne manquée est rattrapée au passage suivant", async () => {
    const job = fakeJob({ dailyAt: { hour: 3, minute: 0 } });
    await jobs.runDueJobs(new Date("2026-10-01T09:41:00Z"), [job]);
    expect(job.calls).toBe(1);
    expect((await runsOf(job.name))[0]!.slot).toBe("2026-10-01T03:00:00.000Z");
  });

  it("échec : enregistré, retenté 15 minutes plus tard, 5 essais au plus", async () => {
    const job = fakeJob({ everyMinutes: 10 }, async () => { throw new Error("panne simulée"); });
    const now = new Date("2026-10-01T11:05:00Z");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await jobs.runDueJobs(now, [job]);
    await jobs.runDueJobs(now, [job]);
    expect(job.calls).toBe(1);
    expect((await runsOf(job.name))[0]).toMatchObject({ status: "failed", error: "panne simulée", attempts: 1 });

    const handle = (await db.getDb())!;
    for (let attempt = 2; attempt <= 6; attempt++) {
      await handle.update(schema.tikisseScheduledJobRuns).set({ finishedAt: new Date(Date.now() - 20 * 60_000) }).where(orm.eq(schema.tikisseScheduledJobRuns.jobName, job.name));
      await jobs.runDueJobs(now, [job]);
    }
    expect(job.calls).toBe(5);
    expect((await runsOf(job.name))[0]!.attempts).toBe(5);
    vi.restoreAllMocks();
  });

  it("une exécution restée « en cours » plus d'une heure (serveur arrêté) est reprise", async () => {
    const job = fakeJob({ everyMinutes: 10 });
    const now = new Date("2026-10-01T12:00:00Z");
    const handle = (await db.getDb())!;
    await handle.insert(schema.tikisseScheduledJobRuns).values({ id: randomUUID(), jobName: job.name, slot: now.toISOString(), status: "running", startedAt: new Date(Date.now() - 2 * 60 * 60_000) });
    await jobs.runDueJobs(now, [job]);
    expect(job.calls).toBe(1);
    expect((await runsOf(job.name))[0]).toMatchObject({ status: "succeeded", attempts: 2 });
  });

  describe("route de déclenchement manuel", () => {
    const secret = "c".repeat(48);
    const job = fakeJob({ dailyAt: { hour: 4, minute: 0 } }, async (options) => ({ days: options.days ?? null }));
    let base = "";
    let close: () => void = () => {};
    beforeAll(async () => {
      const app = express();
      jobs.registerScheduledRoutes(app, [job]);
      const server = app.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      close = () => server.close();
    });
    afterAll(() => {
      close();
      vi.unstubAllEnvs();
    });

    it("sans CRON_SECRET : 503, rien n'est lancé", async () => {
      vi.stubEnv("CRON_SECRET", "");
      const response = await fetch(`${base}/api/scheduled/${job.name}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
      expect(response.status).toBe(503);
      expect(job.calls).toBe(0);
    });

    it("mauvais secret : 403 ; bon secret : exécutée et inscrite comme manuelle, à chaque appel", async () => {
      vi.stubEnv("CRON_SECRET", secret);
      expect((await fetch(`${base}/api/scheduled/${job.name}`, { method: "POST", headers: { Authorization: "Bearer mauvais" } })).status).toBe(403);
      const response = await fetch(`${base}/api/scheduled/${job.name}?days=3`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, days: 3 });
      await fetch(`${base}/api/scheduled/${job.name}`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
      expect(job.calls).toBe(2);
      const runs = await runsOf(job.name);
      expect(runs.every((run) => run.trigger === "manual" && run.slot.startsWith("manual:"))).toBe(true);
    });
  });

  it("les vraies tâches sont déclarées avec leurs horaires", () => {
    expect(jobs.SCHEDULED_JOBS.map((job) => [job.name, job.schedule])).toEqual([
      ["expire-deliveries", { everyMinutes: 10 }],
      ["compute-daily-metrics", { dailyAt: { hour: 0, minute: 15 } }],
      ["finalize-account-deletions", { dailyAt: { hour: 3, minute: 0 } }],
      ["expire-loyalty-grants", { dailyAt: { hour: 4, minute: 0 } }],
    ]);
  });
});
