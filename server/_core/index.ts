import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerStorageProxy } from "./storageProxy";
import { registerAdminDocumentRoutes } from "../admin-documents";
import { consoleHosts, isConsoleHost } from "./console-host";
import { appRouter } from "../routers";
import { createContext } from "./context";
import * as db from "../db";
import { registerScheduledRoutes, startScheduler } from "../scheduled-jobs";
import { corsMiddleware, securityHeadersMiddleware, publicApiRateLimit } from "./security";
import { initSentry, reportException } from "./sentry";
import { assertYengapayWebhookSecretConfigured } from "../yengapay";
import { processYengapayWebhook } from "../yengapay-webhook";

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
    res.header("X-Tikisse-Request-Id", String(requestId));
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
  registerAdminDocumentRoutes(app);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // Tâches planifiées : exécutées par ce serveur (startScheduler, plus bas) ; ces routes servent au
  // déclenchement à la main, protégées par CRON_SECRET (server/scheduled-jobs.ts).
  registerScheduledRoutes(app);

  // Webhook YengaPay — appelé par le PSP pour confirmer un paiement (deposit/withdrawal).
  // Idempotent : on enregistre l'événement, on vérifie la signature, on applique le settlement.
  // Pour les paiements directs (Mobile Money in-app), le settlement déclenche aussi une
  // notification push au client : sans elle, un paiement confirmé alors que l'app est fermée
  // ne serait visible qu'au retour sur le wallet (polling raté).
  app.post("/api/webhooks/yengapay", async (req, res) => {
    const result = await processYengapayWebhook({
      rawBody: (req as { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {}),
      signature: (req.headers["x-webhook-hash"] as string | undefined) ?? (req.headers["x-yengapay-signature"] as string | undefined) ?? null,
      headerEvent: (req.headers["x-yengapay-event"] as string | undefined) ?? null,
    });
    return res.status(result.status).json(result.body);
  });

  // Console d'administration Tikisse : SPA statique compilée séparément (voir admin/README.md),
  // servie par ce même serveur ("même infra") mais sous son propre chemin, isolée du bundle mobile.
  const adminDistPath = path.resolve(process.cwd(), "admin/dist");
  if (fs.existsSync(adminDistPath)) {
    app.use("/admin", express.static(adminDistPath));
    app.get("/admin/*", (_req, res) => res.sendFile(path.join(adminDistPath, "index.html")));
    // Domaine propre à la console (console.tikisse.com) : la console à la racine, jamais l'application.
    // Ses fichiers restent sous /admin/ (base du build), servis juste au-dessus ; l'API, sous /api, passe.
    const hosts = consoleHosts();
    app.use((req, res, next) => {
      if (!isConsoleHost(req.hostname, hosts) || req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/admin/")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (path.extname(req.path)) return res.status(404).end();
      return res.sendFile(path.join(adminDistPath, "index.html"));
    });
  } else {
    app.get("/admin", (_req, res) => res.status(503).send("Console d’administration non compilée. Voir admin/README.md pour la builder (npm run build dans le dossier admin/)."));
  }

  const webDistPath = path.resolve(process.cwd(), "web-build");
  const webIndexPath = path.join(webDistPath, "index.html");
  const hasWebBuild = fs.existsSync(webIndexPath);
  if (hasWebBuild) {
    app.use(express.static(webDistPath, { extensions: ["html"] }));
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

  if (hasWebBuild) {
    app.get("*", (req, res, next) => {
      if (req.path === "/api" || req.path.startsWith("/api/") || req.path === "/admin" || req.path.startsWith("/admin/")) {
        return next();
      }
      if (path.extname(req.path)) return res.status(404).end();
      return res.sendFile(webIndexPath);
    });
  } else {
    app.get("/", (_req, res) => res.status(200).json({ ok: true, service: "Tikisse API" }));
  }

  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    console.error("[express] unhandled error:", err);
    reportException(err, { source: "express", requestId: req.headers?.["x-request-id"] });
    res.status(500).json({ error: { message: err.message ?? "Erreur interne du serveur" } });
  });

  const port = parseInt(process.env.PORT || "3000");
  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);
    startScheduler();
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
