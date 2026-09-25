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
import { assertYengapayWebhookSecretConfigured, parseYengapayWebhookEvent, readYengapayConfig, verifyYengapayWebhookSignature } from "../yengapay";

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
  // Avant toute autre chose : un déploiement live sans secret de webhook ne
  // doit jamais atteindre l'écoute réseau, où l'incident ne se découvrirait
  // qu'au premier paiement qui ne se règle jamais.
  assertYengapayWebhookSecretConfigured();
  await initSentry();
  const app = express();
  const server = createServer(app);

  // Un seul saut de confiance : le déploiement place le serveur derrière son
  // propre reverse proxy / équilibreur, qui pose `X-Forwarded-For` lui-même.
  // Sans ce réglage, `req.ip` ignore l'en-tête et retombe sur l'adresse du
  // proxy pour toutes les requêtes ; avec une valeur trop large (`true`),
  // n'importe quel client pourrait préfixer sa propre IP à l'en-tête, telle
  // quelle relue en confiance. `1` retient l'unique IP juste avant ce saut.
  app.set("trust proxy", 1);

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
  // `kyc.submit` (3 images en base64, jusqu'à ~6,7 Mo chacune d'après kycBase64ImageSchema —
  // server/routers.ts) est la seule mutation dont la charge légitime dépasse de loin celle de
  // toute autre. Comme kyc.submit passe par sa propre route non groupée (voir lib/trpc.ts et le
  // second montage de createExpressMiddleware plus bas), cette limite plus large ne s'applique
  // qu'à elle : les 22 Mo (3 × 6,7 Mo + marge) ne s'appliquent jamais au reste de l'API.
  app.use("/api/trpc-kyc", express.json({ limit: "22mb" }));
  // 2 Mo pour tout le reste : la limite couvrait jusqu'ici l'ensemble de l'API sans distinction,
  // à 50 fois cette taille — un levier de saturation mémoire bien plus généreux que ce qu'aucune
  // mutation ordinaire n'envoie jamais.
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));

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
  // Pour les paiements directs (Mobile Money in-app), le settlement déclenche aussi une
  // notification push au client : sans elle, un paiement confirmé alors que l'app est fermée
  // ne serait visible qu'au retour sur le wallet (polling raté).
  app.post("/api/webhooks/yengapay", async (req, res) => {
    const config = readYengapayConfig();
    if (config.mode === "test") return res.status(503).json({ error: "YengaPay externe est désactivé." });
    const rawBody = (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {});
    const signature = (req.headers["x-webhook-hash"] as string | undefined) ?? (req.headers["x-yengapay-signature"] as string | undefined) ?? null;
    if (!verifyYengapayWebhookSignature(rawBody, signature, config.webhookSecret)) {
      return res.status(400).json({ error: "Signature invalide" });
    }
    try {
      const headerEvent = (req.headers["x-yengapay-event"] as string | undefined) ?? null;
      const event = parseYengapayWebhookEvent(rawBody, signature, headerEvent);
      // Le provider exact (sandbox/live + checkout/direct) est déterminé par la transaction
      // déjà enregistrée en base : on lit d'abord son provider pour logguer et router la notif
      // correctement. Si la transaction n'existe pas encore (race : webhook arrive avant que
      // l'appel API n'ait commité la ligne), on retombe sur le provider par défaut du mode
      // courant et le settle échouera avec un message clair — le webhook réessayé plus tard
      // trouvera la transaction.
      const preLookup = await db.lookupTikisPaymentByProviderReference(event.providerReference);
      const isDirect = preLookup?.provider.startsWith("yengapay_direct_") ?? false;
      const provider = isDirect
        ? (config.mode === "sandbox" ? "yengapay_direct_sandbox" : "yengapay_direct_live")
        : (config.mode === "sandbox" ? "yengapay_sandbox" : "yengapay_live");
      const recorded = await db.recordYengapayWebhookEvent({ provider, providerEventId: event.providerEventId, eventType: event.eventType, paymentTransactionId: preLookup?.id ?? null, payload: rawBody, signature });
      if (recorded.duplicate) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      if (event.eventType.endsWith("pending")) {
        return res.status(202).json({ ok: true, pending: true });
      }
      const outcome: "succeeded" | "failed" | "cancelled" = event.eventType.endsWith("succeeded") ? "succeeded" : event.eventType.endsWith("cancelled") ? "cancelled" : "failed";
      try {
        const settled = await db.settleYengapayLivePayment({ providerReference: event.providerReference, outcome });
        // Notif push : paiement direct + succès ou échec → l'utilisateur est prévenu même
        // app fermée. Pour les paiements checkout (redirection web), la notif est redondante
        // puisque l'utilisateur voit déjà l'écran de confirmation dans le navigateur YengaPay.
        if (isDirect && preLookup?.profilePhone && settled?.payment?.id) {
          const phone = preLookup.profilePhone;
          if (outcome === "succeeded") {
            void db.enqueuePushToPhone({
              phone,
              title: "Dépôt Mobile Money confirmé",
              body: `${settled.payment.amount.toLocaleString("fr-FR")} FCFA crédités sur votre Wallet Tikis.`,
              data: { kind: "wallet_direct_deposit_succeeded", transactionId: settled.payment.id },
              channelId: "tikis-wallet",
            }).catch((pushError) => {
              console.error("[webhook:yengapay] push failed", pushError);
            });
          } else if (outcome === "failed" || outcome === "cancelled") {
            void db.enqueuePushToPhone({
              phone,
              title: "Dépôt Mobile Money échoué",
              body: "Le paiement n'a pas été confirmé par votre opérateur. Le solde de votre Wallet est inchangé.",
              data: { kind: "wallet_direct_deposit_failed", transactionId: settled.payment.id },
              channelId: "tikis-wallet",
            }).catch((pushError) => {
              console.error("[webhook:yengapay] push failed", pushError);
            });
          }
        }
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
  const adminDistPath = path.resolve(process.cwd(), "admin/dist");
  if (fs.existsSync(adminDistPath)) {
    app.use("/admin", express.static(adminDistPath));
    app.get("/admin/*", (_req, res) => res.sendFile(path.join(adminDistPath, "index.html")));
  } else {
    app.get("/admin", (_req, res) => res.status(503).send("Console d’administration non compilée. Voir admin/README.md pour la builder (npm run build dans le dossier admin/)."));
  }

  const trpcHandlerOptions = {
    router: appRouter,
    createContext,
    onError: ({ error, path, type, ctx, req }: { error: unknown; path: string | undefined; type: string; ctx: unknown; req: { headers?: Record<string, string | string[] | undefined> } }) => {
      const trpcError = error as { code?: string };
      if (trpcError.code === "UNAUTHORIZED") return;
      console.error(`[tRPC] ${type} ${path} failed:`, error);
      reportException(error, { source: "trpc", path, type, requestId: req?.headers?.["x-request-id"] });
    },
  };
  app.use("/api/trpc", createExpressMiddleware(trpcHandlerOptions));
  // Route dédiée pour kyc.submit (voir lib/trpc.ts : splitLink l'exclut du groupage tRPC), afin
  // que la limite de charge élargie ci-dessus ne s'applique qu'à elle. Même routeur, même
  // contexte : ce n'est qu'un second point d'entrée vers la même API.
  app.use("/api/trpc-kyc", createExpressMiddleware(trpcHandlerOptions));

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

startServer().catch((error) => {
  // Un simple `.catch(console.error)` laisse le processus sortir avec le code
  // 0 par défaut : un orchestrateur (systemd, Docker, pm2) lirait ça comme un
  // déploiement réussi. Le secret de webhook manquant, entre autres échecs de
  // démarrage, doit se voir comme un vrai échec.
  console.error(error);
  process.exit(1);
});
