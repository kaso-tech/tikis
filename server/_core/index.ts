import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "node:path";
import fs from "node:fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { sdk } from "./sdk";
import { expireOpenTikisDeliveries } from "../db";
import { publishDeliveryStatusBroadcast } from "../supabase-realtime";

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
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Tikis-Admin-Session",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

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
      },
    }),
  );

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    console.error("[express] unhandled error:", err);
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
