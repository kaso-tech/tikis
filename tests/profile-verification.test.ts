import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { profileVerification } from "../lib/profile-verification";

const driver = { role: "driver" as const, hasPhoto: true };

describe("état de vérification d'un profil", () => {
  it("ne dit rien à un expéditeur, qui ne passe pas de vérification d'identité", () => {
    expect(profileVerification({ role: "sender", hasPhoto: false, kycStatus: null })).toBeNull();
    expect(profileVerification({ role: "sender", hasPhoto: true, kycStatus: "approved" })).toBeNull();
  });

  it("n'annonce « vérifié » que sur un dossier approuvé", () => {
    const approved = profileVerification({ ...driver, kycStatus: "approved", submittedAt: "2025-03-18T10:00:00Z" });
    expect(approved).toMatchObject({ tone: "verified", target: "kyc" });
    expect(approved?.title).toBe("Identité vérifiée le 18 mars 2025");
    expect(approved?.action).toBeUndefined();
  });

  it("distingue le dossier envoyé du dossier absent", () => {
    expect(profileVerification({ ...driver, kycStatus: "submitted" })).toMatchObject({ tone: "pending" });
    expect(profileVerification({ ...driver, kycStatus: null })).toMatchObject({ tone: "blocked", action: "Envoyer mes documents" });
  });

  it("reprend le motif du refus plutôt qu'une formule générique", () => {
    const rejected = profileVerification({ ...driver, kycStatus: "rejected", rejectionReason: "La photo du verso est illisible." });
    expect(rejected?.detail).toBe("La photo du verso est illisible.");
    expect(rejected?.action).toBe("Renvoyer mes documents");
    // Un motif vide ne doit pas laisser l'expéditeur sans consigne.
    expect(profileVerification({ ...driver, kycStatus: "rejected", rejectionReason: "   " })?.detail).toBeTruthy();
  });

  it("réclame la photo avant le dossier, parce que l'accueil la réclame déjà", () => {
    const missing = profileVerification({ role: "driver", hasPhoto: false, kycStatus: "approved" });
    expect(missing).toMatchObject({ tone: "blocked", target: "photo", action: "Ajouter ma photo" });
  });

  it("ne datte rien quand la date est absente ou illisible", () => {
    expect(profileVerification({ ...driver, kycStatus: "approved", submittedAt: null })?.title).toBe("Identité vérifiée");
    expect(profileVerification({ ...driver, kycStatus: "approved", submittedAt: "pas-une-date" })?.title).toBe("Identité vérifiée");
  });
});

describe("la page de profil", () => {
  const source = readFileSync(join(process.cwd(), "app/(tabs)/profile.tsx"), "utf8");
  const contact = readFileSync(join(process.cwd(), "components/tikis/contact-section.tsx"), "utf8");
  const sessions = readFileSync(join(process.cwd(), "components/tikis/sessions-section.tsx"), "utf8");

  it("lit le dossier KYC au lieu d'écrire « vérifié » en dur", () => {
    expect(source).toContain("trpc.kyc.status.useQuery");
    expect(source).toContain("profileVerification(");
    expect(source).not.toContain("LIVREUR VÉRIFIÉ");
    expect(source).not.toContain("EXPÉDITEUR VÉRIFIÉ");
  });

  it("ne déduit plus l'état d'un dossier du nombre d'avis reçus", () => {
    expect(source).not.toMatch(/receivedReviews\.length > 0 \? "Profil complet/);
    expect(source).not.toMatch(/badge=\{receivedReviews\.length > 0/);
  });

  it("range la liste des sessions derrière une ligne, plutôt qu'en tête de page", () => {
    expect(source).not.toContain("<SessionsSection");
    expect(source).toContain('router.push("/sessions"');
  });

  it("suit le même ordre que la maquette validée", () => {
    const order = ["Mon compte", "Mon travail", "Sécurité"].map((t) => source.indexOf(`title="${t}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("ne garde ni le solde tronqué ni le code mort", () => {
    // La tuile « Wallet » coupait le montant (« 16 000 F… ») et doublait l'onglet.
    expect(source).not.toContain("availableWalletBalance");
    expect(source).not.toContain("CoverAction");
  });

  it("vouvoie partout, y compris là où le bloc sessions tutoyait", () => {
    for (const text of [source, contact, sessions]) {
      expect(text).not.toMatch(/\bRévoque\b|\bsur ton compte\b|\bque tu ne reconnais\b/);
    }
  });
});
