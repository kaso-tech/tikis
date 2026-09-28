/**
 * Pièces d'identité KYC et pièces jointes de signalement, servies à la console d'administration seulement.
 *
 * Jusqu'ici, ces fichiers passaient par le proxy public `/manus-storage/*`, qui les servait à quiconque
 * connaissait le chemin (numéro de téléphone, horodatage et 8 caractères aléatoires). Désormais :
 *  - le proxy public les refuse (`isPrivateStorageKey`) ;
 *  - cette route exige une session admin active, un rôle qui en a l'usage (super_admin, support) et une
 *    double authentification faite si elle est exigée ;
 *  - la clé du fichier est lue en base à partir de l'identifiant du dossier, jamais dans l'URL : la route ne
 *    peut servir que ce pour quoi elle existe ;
 *  - le fichier transite par le serveur : l'URL signée du stockage ne quitte jamais le serveur ;
 *  - chaque consultation est inscrite au journal d'audit.
 */
import type { Express, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { tikisDeliveryReports, tikisKycSubmissions } from "../drizzle/schema";
import { adminSessionCookieValue } from "./_core/context";
import { clientIp } from "./_core/security";
import { authenticateAdminSession, writeAdminAuditLog } from "./admin-db";
import { getDb } from "./db";
import { storageReadObject } from "./storage";

/** Qui voit quoi : les pièces d'identité aussi pour le rôle « KYC seul », les photos de signalement non. */
export const ADMIN_DOCUMENT_ROLES = { kyc: ["super_admin", "support", "kyc_reviewer"], report: ["super_admin", "support"] } as const;
export const KYC_DOCUMENT_SIDES = { "id-front": "idFrontKey", "id-back": "idBackKey", selfie: "selfieKey" } as const;
export type KycDocumentSide = keyof typeof KYC_DOCUMENT_SIDES;

export type AdminDocumentRequest = { kind: "kyc"; submissionId: string; side: string } | { kind: "report"; reportId: string };
export type AdminDocumentResult = { status: 200; body: Buffer; contentType: string } | { status: 401 | 403 | 404 | 502 | 503; message: string };

type ReadObject = (key: string) => Promise<{ body: Buffer; contentType: string }>;

async function documentKey(request: AdminDocumentRequest): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  if (request.kind === "kyc") {
    if (!Object.hasOwn(KYC_DOCUMENT_SIDES, request.side)) return null;
    const submission = (await db.select().from(tikisKycSubmissions).where(eq(tikisKycSubmissions.id, request.submissionId)).limit(1))[0];
    return submission ? submission[KYC_DOCUMENT_SIDES[request.side as KycDocumentSide]] : null;
  }
  const report = (await db.select({ attachmentKey: tikisDeliveryReports.attachmentKey }).from(tikisDeliveryReports).where(eq(tikisDeliveryReports.id, request.reportId)).limit(1))[0];
  return report?.attachmentKey ?? null;
}

export async function resolveAdminDocument(input: { sessionToken: string | undefined; request: AdminDocumentRequest; ipAddress?: string }, read: ReadObject = storageReadObject): Promise<AdminDocumentResult> {
  const admin = await authenticateAdminSession(input.sessionToken);
  if (!admin) return { status: 401, message: "Session d’administration invalide ou expirée." };
  if (admin.mustEnrollTotp) return { status: 403, message: "Activez la double authentification pour accéder à la console." };
  if (admin.mustChangePassword) return { status: 403, message: "Choisissez votre mot de passe pour accéder à la console." };
  if (!(ADMIN_DOCUMENT_ROLES[input.request.kind] as readonly string[]).includes(admin.role)) return { status: 403, message: "Votre rôle d’administration ne donne pas accès aux pièces justificatives." };
  const key = await documentKey(input.request);
  if (!key) return { status: 404, message: "Document introuvable." };
  let object: { body: Buffer; contentType: string };
  try {
    object = await read(key);
  } catch (cause) {
    console.error("[admin-documents] lecture impossible", cause);
    return { status: 502, message: "Document momentanément indisponible." };
  }
  await writeAdminAuditLog({
    adminId: admin.adminId, adminEmail: admin.email, ipAddress: input.ipAddress,
    ...(input.request.kind === "kyc"
      ? { action: "kyc_document_viewed", targetType: "kyc_submission", targetId: input.request.submissionId, details: { side: input.request.side } }
      : { action: "report_attachment_viewed", targetType: "delivery_report", targetId: input.request.reportId }),
  });
  // Seules des images sont déposées (validées à l'envoi) ; tout autre type est servi comme binaire opaque,
  // jamais interprété par le navigateur.
  const contentType = /^image\/(jpeg|png|webp)$/.test(object.contentType) ? object.contentType : "application/octet-stream";
  return { status: 200, body: object.body, contentType };
}

function send(res: Response, result: AdminDocumentResult) {
  res.set("Cache-Control", "no-store, private");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  if (result.status !== 200) {
    res.status(result.status).type("text/plain").send(result.message);
    return;
  }
  res.status(200).type(result.contentType).set("Content-Disposition", "inline").send(result.body);
}

export function registerAdminDocumentRoutes(app: Express) {
  app.get("/api/admin/documents/kyc/:submissionId/:side", async (req: Request, res: Response) => {
    send(res, await resolveAdminDocument({ sessionToken: adminSessionCookieValue(req), request: { kind: "kyc", submissionId: String(req.params.submissionId), side: String(req.params.side) }, ipAddress: clientIp(req) }));
  });
  app.get("/api/admin/documents/report/:reportId", async (req: Request, res: Response) => {
    send(res, await resolveAdminDocument({ sessionToken: adminSessionCookieValue(req), request: { kind: "report", reportId: String(req.params.reportId) }, ipAddress: clientIp(req) }));
  });
}
