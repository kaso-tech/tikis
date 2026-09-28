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

describe("lot 2 — la console ne manipule plus aucun jeton de session", () => {
  const trpcClient = read("admin/src/lib/trpc.ts");
  const auth = read("admin/src/lib/auth.tsx");

  it("aucun jeton n'est lu ni écrit dans localStorage ; l'ancien est effacé", () => {
    expect(trpcClient).not.toContain("localStorage.getItem");
    expect(trpcClient).not.toContain("localStorage.setItem");
    expect(trpcClient).toContain("localStorage.removeItem(LEGACY_SESSION_KEY)");
    expect(trpcClient).not.toContain("x-tikis-admin-session");
  });

  it("chaque requête porte l'en-tête de la console et le cookie", () => {
    expect(trpcClient).toContain('headers: () => ({ "x-tikis-admin": "1" })');
    expect(trpcClient).toContain('credentials: "include"');
  });

  it("se déconnecter révoque la session côté serveur", () => {
    expect(auth).toContain("await trpc.adminConsole.auth.logout.mutate();");
  });

  it("le serveur n'accepte plus le jeton en en-tête, et CORS n'autorise plus cet en-tête", () => {
    expect(read("server/_core/context.ts")).not.toContain('headers["x-tikis-admin-session"]');
    const security = read("server/_core/security.ts");
    expect(security).not.toContain("X-Tikis-Admin-Session");
    expect(security).toContain("X-Tikis-Admin,");
  });

  it("la carte en direct n'apparaît qu'aux rôles qui y ont droit", () => {
    expect(read("admin/src/App.tsx")).toContain('{ key: "map", label: "Carte temps réel", href: "/admin/map", icon: "◎", group: "ops", roles: ["super_admin", "support"] }');
    expect(read("server/admin-router.ts")).toContain('liveLocations: tikisAdminProcedure.use(requireTikisAdminRole("super_admin", "support"))');
  });

  it("la migration crée la table des sessions, sans jamais y stocker le jeton en clair", () => {
    const migration = read("drizzle/manual/0044_admin_sessions.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `tikis_admin_sessions`");
    expect(migration).toContain("`tokenHash` varchar(64) NOT NULL");
    expect(migration).not.toMatch(/`token` /);
  });
});

describe("lot 3 — double authentification dans la console", () => {
  it("la connexion enchaîne mot de passe puis code, codes de secours acceptés", () => {
    const login = read("admin/src/pages/LoginPage.tsx");
    expect(login).toContain('if (outcome === "totp_required")');
    expect(login).toContain('autoComplete="one-time-code"');
    expect(read("admin/src/lib/auth.tsx")).toContain("trpc.adminConsole.auth.verifyTotp.mutate({ code })");
  });

  it("un compte qui doit s'enrôler ne voit que « Mon compte »", () => {
    const app = read("admin/src/App.tsx");
    expect(app).toContain('NAV.filter((item) => item.key === "account")');
    expect(app).toContain('const activePage: PageKey = admin.mustEnrollTotp ? "account" : page;');
  });

  it("les codes de secours restent affichés jusqu'à ce que l'admin confirme les avoir notés", () => {
    const account = read("admin/src/pages/AccountPage.tsx");
    expect(account).toContain("setRecoveryCodes(result.recoveryCodes);");
    expect(account).toContain("J’ai noté mes codes");
  });

  it("le serveur ferme toute la console tant que l'enrôlement obligatoire n'est pas fait", () => {
    const trpcCore = read("server/_core/trpc.ts");
    expect(trpcCore).toContain("if (opts.ctx.tikisAdmin.mustEnrollTotp) {");
    const router = read("server/admin-router.ts");
    expect(router).toContain("begin: tikisAdminEnrollmentProcedure");
    expect(router).toContain("confirm: tikisAdminEnrollmentProcedure");
    // La désactivation, elle, reste derrière la procédure complète.
    expect(router).toContain("disable: tikisAdminProcedure");
  });

  it("la liste des rôles soumis à l'obligation est la même côté écran et côté serveur", async () => {
    const page = read("admin/src/pages/AdminsPage.tsx");
    const declared = /const TOTP_REQUIRED_ROLES = (\[[^\]]*\]);/.exec(page)?.[1];
    const { TOTP_REQUIRED_ROLES } = await import("../server/admin-db");
    expect(JSON.parse(declared ?? "[]")).toEqual([...TOTP_REQUIRED_ROLES]);
  });

  it("la migration ajoute le secret chiffré, l'étape de session et la politique", () => {
    const migration = read("drizzle/manual/0045_admin_totp.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS `totpSecret` varchar(255)");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS `stage` enum('pending_totp','active') NOT NULL DEFAULT 'active'");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS `adminTotpRequired` boolean NOT NULL DEFAULT false");
  });

  it("qrcode est une dépendance d'exécution : le serveur de production le charge (esbuild --packages=external)", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies.qrcode).toBeDefined();
    expect(pkg.devDependencies?.qrcode).toBeUndefined();
  });
});

describe("lot 4 — pièces justificatives servies par la route admin", () => {
  it("la console ne charge plus aucune pièce par le proxy public", () => {
    const kyc = read("admin/src/pages/KycPage.tsx");
    expect(kyc).not.toContain("/manus-storage/");
    expect(kyc).toContain("/api/admin/documents/kyc/");
    expect(read("admin/src/pages/ReportsPage.tsx")).toContain("/api/admin/documents/report/");
  });

  it("les rôles qui voient les pièces sont les mêmes côté écran et côté serveur", async () => {
    const { ADMIN_DOCUMENT_ROLES } = await import("../server/admin-documents");
    expect([...ADMIN_DOCUMENT_ROLES]).toEqual(["super_admin", "support"]);
    expect(read("admin/src/pages/KycPage.tsx")).toContain('const canReview = admin?.role === "super_admin" || admin?.role === "support";');
  });

  it("le proxy public filtre avant toute autre étape, et la route admin est montée", () => {
    const proxy = read("server/_core/storageProxy.ts");
    expect(proxy.indexOf("isPrivateStorageKey(key)")).toBeLessThan(proxy.indexOf("ENV.forgeApiUrl"));
    expect(read("server/_core/index.ts")).toContain("registerAdminDocumentRoutes(app);");
  });
});
