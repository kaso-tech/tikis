import type { Express, Request, Response } from "express";
import { isPrivateStorageKey, storageGetSignedUrl } from "../storage";

/**
 * Fichiers non privés (photos de profil) : redirection vers un lien signé Supabase de quelques minutes.
 * `/manus-storage/*` reste servi à l'identique pour une application installée avant le passage à Supabase,
 * qui aurait gardé une ancienne adresse en mémoire.
 */
export function registerStorageProxy(app: Express) {
  const serve = async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0] ?? "";
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    // Pièces d'identité KYC et pièces jointes de signalement : jamais par cette route publique, qui sert quiconque
    // connaît le chemin. Elles passent par /api/admin/documents (session admin, rôle vérifié, accès journalisé).
    // 404 plutôt que 403 : ne pas confirmer qu'un fichier existe à ce chemin.
    if (isPrivateStorageKey(key)) {
      res.status(404).send("Not found");
      return;
    }
    try {
      const url = await storageGetSignedUrl(key);
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  };
  app.get("/api/files/*", serve);
  app.get("/manus-storage/*", serve);
}
