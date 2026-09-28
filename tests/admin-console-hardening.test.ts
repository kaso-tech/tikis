/**
 * Garde-fous de la console d'administration qui ne demandent pas de base : droits par rôle déclarés sur
 * les procédures, écrans alignés sur ces droits, export CSV neutralisé.
 * Les comportements qui touchent à l'argent et aux sessions sont vérifiés sur une vraie base dans
 * tests/admin-console-audit.db.test.ts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { escapeCell, rowsToCsv } from "../admin/src/lib/csv";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("export CSV — aucune cellule saisie par un utilisateur ne devient une formule", () => {
  it.each(["=HYPERLINK(\"http://x\",\"clic\")", "+33 1 23", "-2+3", "@SUM(A1)", "\t=1"])("neutralise %s", (value) => {
    expect(escapeCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });

  it("laisse intacts les nombres, même négatifs, et le texte ordinaire", () => {
    expect(escapeCell(-1500)).toBe("-1500");
    expect(escapeCell("Awa Ouédraogo")).toBe("Awa Ouédraogo");
  });

  it("s'applique dans l'export complet", () => {
    const csv = rowsToCsv([{ nom: "=cmd|' /C calc'!A0" }]);
    expect(csv.split("\n")[1]).toBe("'=cmd|' /C calc'!A0");
  });
});

describe("droits par rôle", () => {
  const router = read("server/admin-router.ts");

  it("trancher un signalement est réservé au support et aux super-admins", () => {
    expect(router).toMatch(/resolve: tikisAdminProcedure\.use\(requireTikisAdminRole\("super_admin", "support"\)\)/);
  });

  it("la suspension d'un admin passe l'auteur de l'action au serveur", () => {
    expect(router).toContain("setAdminUserActive({ actorAdminId: ctx.tikisAdmin.adminId, adminId: input.adminId, active: input.active })");
  });

  it("la session admin est relue en base à chaque requête", () => {
    const context = read("server/_core/context.ts");
    expect(context).toContain("tikisAdmin: await authenticateAdminSession(adminSessionToken)");
    expect(context).not.toMatch(/tikisAdmin: await verifyAdminSession\(/);
  });

  it("l'écran des signalements n'offre les actions qu'aux rôles autorisés", () => {
    const page = read("admin/src/pages/ReportsPage.tsx");
    expect(page).toContain('const canResolve = admin?.role === "super_admin" || admin?.role === "support";');
    expect(page).toContain("{canResolve ? <div");
  });

  it("l'écran de l'équipe n'offre pas de se suspendre soi-même", () => {
    expect(read("admin/src/pages/AdminsPage.tsx")).toContain("row.id === admin?.adminId");
  });
});

describe("bonus et pénalités depuis la fiche utilisateur", () => {
  const page = read("admin/src/pages/UsersPage.tsx");

  it("l'identifiant d'opération est tiré avec le brouillon, pas à chaque clic", () => {
    expect(page).not.toMatch(/users\.(reward|penalize)\.mutate\(\{[^}]*requestId: crypto\.randomUUID\(\)/);
    expect(page).toContain("requestId: rewardDraft.requestId");
    expect(page).toContain("requestId: penaltyDraft.requestId");
  });

  it("la clé de mouvement côté serveur porte le numéro du profil", () => {
    const adminDb = read("server/admin-db.ts");
    expect(adminDb).toContain("idempotencyKey: `admin-reward:${input.phone}:${input.requestId}`");
    expect(adminDb).toContain("idempotencyKey: `admin-penalty:${input.phone}:${input.requestId}`");
  });
});

describe("dépôts YengaPay dans l'écran Finance", () => {
  it("la liste des fournisseurs simulés est la même que côté serveur", async () => {
    const { YENGAPAY_TEST_PROVIDERS } = await import("../server/yengapay");
    const page = read("admin/src/pages/FinancePage.tsx");
    const declared = /const SIMULATED_PROVIDERS = (\[[^\]]*\]);/.exec(page)?.[1];
    expect(JSON.parse(declared ?? "[]")).toEqual([...YENGAPAY_TEST_PROVIDERS]);
  });

  it("un vrai dépôt YengaPay se vérifie auprès de YengaPay, il ne se valide pas à la main", () => {
    const page = read("admin/src/pages/FinancePage.tsx");
    expect(page).toContain("isRealYengapayDeposit(t)");
    expect(page).toContain("finance.reconcileYengapayPayment.mutate({ providerReference: t.providerReference })");
  });
});

describe("lot 1 — décisions financières encadrées dans les écrans", () => {
  const finance = read("admin/src/pages/FinancePage.tsx");

  it("Valider et Rejeter passent par une confirmation, jamais par un appel direct", () => {
    expect(finance).not.toMatch(/onClick=\{\(\) => void settle\(/);
    expect(finance).toContain('onClick={() => askSettle(t, "succeeded")}');
    expect(finance).toContain('onClick={() => askSettle(t, "failed")}');
  });

  it("valider un retrait demande la référence de versement et une note", () => {
    expect(finance).toContain('const needsPayoutProof = pendingSettle?.transaction.type === "withdrawal" && pendingSettle.outcome === "succeeded";');
    expect(finance).toContain('id="payout-reference"');
    expect(finance).toContain("payoutReference: needsPayoutProof ? payoutReference : undefined");
  });

  it("la fiche utilisateur montre ce que la suspension a libéré et ce qui reste à décider", () => {
    const users = read("admin/src/pages/UsersPage.tsx");
    expect(users).toContain("statusOutcome.releasedCandidacies");
    expect(users).toContain("statusOutcome.engagements.map(");
  });

  it("la migration ajoute la référence de versement, unique", () => {
    const migration = read("drizzle/manual/0043_withdrawal_payout_reference.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS `payoutReference` varchar(80)");
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS `tikis_payment_transactions_payoutReference_unique`");
    expect(read("drizzle/schema.ts")).toContain('payoutReference: varchar("payoutReference", { length: 80 }).unique()');
  });
});
