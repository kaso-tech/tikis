import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

const index = read("server/_core/index.ts");
const trpcClient = read("lib/trpc.ts");

describe("la charge maximale d'une requête API correspond à ce qu'elle transporte", () => {
  it("la limite générale est resserrée à 2 Mo", () => {
    // C'était 50 Mo pour toute l'API — un levier de saturation mémoire bien plus généreux
    // qu'aucune mutation ordinaire n'en a jamais besoin.
    expect(index).toContain('express.json({ limit: "2mb" })');
    expect(index).toContain('express.urlencoded({ limit: "2mb", extended: true })');
    // Le commentaire au-dessus rappelle l'ancienne valeur : seul un appel actif l'utilisant
    // encore ferait échouer ce test.
    expect(index).not.toContain('limit: "50mb"');
  });

  it("kyc.submit garde sa propre route, avec une limite élargie qui ne couvre qu'elle", () => {
    expect(index).toContain('app.use("/api/trpc-kyc", express.json({ limit: "22mb" }))');
    expect(index).toContain('app.use("/api/trpc-kyc", createExpressMiddleware(trpcHandlerOptions))');
  });

  it("le webhook PSP garde sa limite et sa capture du corps brut, inchangées", () => {
    expect(index).toContain('app.use("/api/webhooks", express.json({ limit: "1mb"');
    expect(index).toContain("rawBody");
  });

  it("le client route kyc.submit hors du groupage tRPC, vers la route élargie", () => {
    // Un lien groupé (httpBatchLink) aurait pu combiner kyc.submit avec un appel arrivé au même
    // instant (ce dépôt interroge en polling toutes les 5 à 8 s) dans une seule requête HTTP :
    // la correspondance par préfixe de chemin, côté serveur, l'aurait alors manquée.
    expect(trpcClient).toContain('condition: (op) => op.path === "kyc.submit"');
    expect(trpcClient).toContain("/api/trpc-kyc");
    expect(trpcClient).toContain("httpLink({");
  });
});
