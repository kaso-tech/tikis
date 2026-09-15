import { describe, expect, it } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { isUnauthorizedTrpcError } from "../lib/trpc-error";

/**
 * Avant ce garde, un rejet UNAUTHORIZED d'une requête protégée (session expirée, cookie rejeté par
 * le navigateur, révocation…) n'était traité nulle part côté client : chaque écran retombait sur son
 * état vide habituel, sans qu'aucun message n'explique que la session, pas les données, est en cause.
 * Ces tests couvrent la détection — le vrai comportement (déconnexion + redirection) nécessite un
 * QueryClient et un routeur montés, vérifiés manuellement (voir le commit de ce fichier).
 */
describe("détection d'une erreur tRPC UNAUTHORIZED", () => {
  it("reconnaît un TRPCClientError avec le code UNAUTHORIZED", () => {
    const error = new TRPCClientError("Unauthorized", { result: { error: { code: -32001 as any, message: "Unauthorized", data: { code: "UNAUTHORIZED", httpStatus: 401 } } } });
    expect(isUnauthorizedTrpcError(error)).toBe(true);
  });

  it("ignore un TRPCClientError avec un autre code", () => {
    const error = new TRPCClientError("Bad request", { result: { error: { code: -32600 as any, message: "Bad request", data: { code: "BAD_REQUEST", httpStatus: 400 } } } });
    expect(isUnauthorizedTrpcError(error)).toBe(false);
  });

  it("reconnaît une erreur déjà 'dépaquetée' portant data.code UNAUTHORIZED", () => {
    expect(isUnauthorizedTrpcError({ data: { code: "UNAUTHORIZED" } })).toBe(true);
  });

  it("ignore les valeurs non pertinentes sans lever", () => {
    expect(isUnauthorizedTrpcError(null)).toBe(false);
    expect(isUnauthorizedTrpcError(undefined)).toBe(false);
    expect(isUnauthorizedTrpcError(new Error("réseau indisponible"))).toBe(false);
    expect(isUnauthorizedTrpcError("UNAUTHORIZED")).toBe(false);
  });
});
