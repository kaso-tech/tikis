import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { sdk } from "./sdk";
import * as db from "../db";
import { expireOpenTikisDeliveries, finalizeExpiredAccountDeletions } from "../db";
import { expireLoyaltyGrants } from "../loyalty";
import { publishDeliveryStatusBroadcast } from "../supabase-realtime";
import { corsMiddleware, securityHeadersMiddleware, publicApiRateLimit } from "./security";
import { initSentry, reportException } from "./sentry";
import { parseYengapayWebhookEvent, readYengapayConfig, verifyYengapayWebhookSignature } from "../yengapay";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  await initSentry();
  const app = express();
  const server = createServer(app);

  app.use(securityHeadersMiddleware);
  app.use(corsMiddleware);
  app.use((req, res, next) => {
    const requestId = req.headers["x-request-id"] || randomUUID();
    res.header("X-Tikis-Request-Id", String(requestId));
    next();
  });
  app.use(publicApiRateLimit);

  // Capture le raw body pour la validation de signature des webhooks PSP.
  app.use("/api/webhooks", express.json({ limit: "1mb", verify: (req, _res, buf) => { (req as { rawBody?: string }).rawBody = buf.toString("utf8"); } }));
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.post("/api/scheduled/expire-deliveries", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await expireOpenTikisDeliveries();
      for (const deliveryId of result.completedDeliveryIds) {
        void publishDeliveryStatusBroadcast({ deliveryId, status: "completed", title: "Livraison finalisée automatiquement", body: "La course active a été clôturée après 24 heures.", occurredAt: new Date().toISOString() });
      }
      for (const deliveryId of result.expiredDeliveryIds) {
        void publishDeliveryStatusBroadcast({ deliveryId, status: "expired", title: "Livraison non terminée", body: "La course a expiré avant son démarrage et ses mouvements financiers ont été annulés.", occurredAt: new Date().toISOString() });
      }
      return res.json({ ok: true, ...result, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[scheduled:expire-deliveries]", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/finalize-account-deletions", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      await finalizeExpiredAccountDeletions();
      return res.json({ ok: true, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[scheduled:finalize-account-deletions]", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/expire-loyalty-grants", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const result = await expireLoyaltyGrants();
      return res.json({ ok: true, ...result, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[scheduled:expire-loyalty-grants]", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });

  app.post("/api/scheduled/compute-daily-metrics", async (req, res) => {
    try {
      const user = await sdk.authenticateRequest(req);
      if (!user.isCron || !user.taskUid) return res.status(403).json({ error: "cron-only" });
      const { computeRecentMetrics } = await import("../analytics-metrics");
      const days = Number(req.query?.days ?? 7);
      const cappedDays = Math.min(Math.max(Number.isFinite(days) ? days : 7, 1), 30);
      const metrics = await computeRecentMetrics(cappedDays);
      return res.json({ ok: true, days: cappedDays, metrics, taskUid: user.taskUid });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error("[scheduled:compute-daily-metrics]", error);
      return res.status(500).json({ error: message, timestamp: new Date().toISOString() });
    }
  });

  // Webhook YengaPay — appelé par le PSP pour confirmer un paiement (deposit/withdrawal).
  // Idempotent : on enregistre l'événement, on vérifie la signature, on applique le settlement.
  app.post("/api/webhooks/yengapay", async (req, res) => {
    const config = readYengapayConfig();
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = (req.headers["x-yengapay-signature"] as string | undefined) ?? null;
    if (!verifyYengapayWebhookSignature(rawBody, signature, config.webhookSecret)) {
      return res.status(400).json({ error: "Signature invalide" });
    }
    try {
      const event = parseYengapayWebhookEvent(rawBody, signature);
      const recorded = await db.recordYengapayWebhookEvent({ providerEventId: event.providerEventId, eventType: event.eventType, paymentTransactionId: null, payload: rawBody, signature });
      if (recorded.duplicate) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const outcome: "succeeded" | "failed" | "cancelled" = event.eventType.endsWith("succeeded") ? "succeeded" : event.eventType.endsWith("cancelled") ? "cancelled" : "failed";
      try {
        await db.settleYengapayLivePayment({ providerReference: event.providerReference, outcome });
        return res.status(200).json({ ok: true });
      } catch (settleError) {
        const reason = settleError instanceof Error ? settleError.message : "Erreur inconnue";
        console.error("[webhook:yengapay] settle failed", settleError);
        return res.status(202).json({ ok: false, error: reason, willRetry: true });
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Erreur inconnue";
      console.error("[webhook:yengapay] parse failed", cause);
      return res.status(400).json({ error: message });
    }
  });

  // Console d'administration Tikis : SPA statique compilée séparément (voir admin/README.md),
  // servie par ce même serveur ("même infra") mais sous son propre chemin, isolée du bundle mobile.
  const adminDistPath = path.join(__dirname, "../../admin/dist");
  if (fs.existsSync(adminDistPath)) {
    app.use("/admin", express.static(adminDistPath));
    app.get("/admin/*", (_req, res) => res.sendFile(path.join(adminDistPath, "index.html")));
  } else {
    app.get("/admin", (_req, res) => res.status(503).send("Console d’administration non compilée. Voir admin/README.md pour la builder (npm run build dans le dossier admin/)."));
  }

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ error, path, type, ctx, req }) => {
        console.error(`[tRPC] ${type} ${path} failed:`, error);
        reportException(error, { source: "trpc", path, type, requestId: req?.headers?.["x-request-id"] });
      },
    }),
  );

  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    console.error("[express] unhandled error:", err);
    reportException(err, { source: "express", requestId: req.headers?.["x-request-id"] });
    res.status(500).json({ error: { message: err.message ?? "Erreur interne du serveur" } });
  });

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
  });
}

startServer().catch(console.error);
