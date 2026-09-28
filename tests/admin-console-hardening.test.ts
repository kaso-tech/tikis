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
    expect(router).toMatch(/resolve: adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "support"\)\)/);
  });

  it("la suspension d'un admin passe l'auteur de l'action au serveur", () => {
    expect(router).toContain("setAdminUserActive({ actorAdminId: ctx.tikisseAdmin.adminId, adminId: input.adminId, active: input.active })");
  });

  it("la session admin est relue en base à chaque requête", () => {
    const context = read("server/_core/context.ts");
    expect(context).toContain("tikisseAdmin: await authenticateAdminSession(adminSessionToken)");
    expect(context).not.toMatch(/tikisseAdmin: await verifyAdminSession\(/);
  });

  it("l'écran des signalements n'offre les actions qu'aux rôles autorisés", () => {
    const page = read("admin/src/pages/ReportsPage.tsx");
    expect(page).toContain('const canResolve = admin?.role === "super_admin" || admin?.role === "support";');
    expect(page).toContain("{!canResolve ? <p");
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
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS `tikisse_payment_transactions_payoutReference_unique`");
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
    expect(trpcClient).not.toContain("x-tikisse-admin-session");
  });

  it("chaque requête porte l'en-tête de la console et le cookie", () => {
    expect(trpcClient).toContain('headers: () => ({ "x-tikisse-admin": "1" })');
    expect(trpcClient).toContain('credentials: "include"');
  });

  it("se déconnecter révoque la session côté serveur", () => {
    expect(auth).toContain("await trpc.adminConsole.auth.logout.mutate();");
  });

  it("le serveur n'accepte plus le jeton en en-tête, et CORS n'autorise plus cet en-tête", () => {
    expect(read("server/_core/context.ts")).not.toContain('headers["x-tikisse-admin-session"]');
    const security = read("server/_core/security.ts");
    expect(security).not.toContain("X-Tikisse-Admin-Session");
    expect(security).toContain("X-Tikisse-Admin,");
  });

  it("la carte en direct n'apparaît qu'aux rôles qui y ont droit", () => {
    expect(read("admin/src/App.tsx")).toContain('{ key: "map", label: "Carte temps réel", href: "/admin/map", icon: "◎", group: "ops", roles: ["super_admin", "support"] }');
    expect(read("server/admin-router.ts")).toContain('liveLocations: adminProcedure.use(requireTikisseAdminRole("super_admin", "support"))');
  });

  it("la migration crée la table des sessions, sans jamais y stocker le jeton en clair", () => {
    const migration = read("drizzle/manual/0044_admin_sessions.sql");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `tikisse_admin_sessions`");
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
    expect(app).toContain('const activePage: PageKey = setupPending ? "account" :');
  });

  it("les codes de secours restent affichés jusqu'à ce que l'admin confirme les avoir notés", () => {
    const account = read("admin/src/pages/AccountPage.tsx");
    expect(account).toContain("setRecoveryCodes(result.recoveryCodes);");
    expect(account).toContain("J’ai noté mes codes");
  });

  it("le serveur ferme toute la console tant que l'enrôlement obligatoire n'est pas fait", () => {
    const trpcCore = read("server/_core/trpc.ts");
    expect(trpcCore).toContain("if (opts.ctx.tikisseAdmin.mustEnrollTotp) {");
    const router = read("server/admin-router.ts");
    expect(router).toContain("begin: tikisseAdminEnrollmentProcedure");
    expect(router).toContain("confirm: tikisseAdminEnrollmentProcedure");
    // La désactivation, elle, reste derrière la procédure complète.
    expect(router).toContain("disable: adminProcedure");
    // `adminProcedure` (trace d'audit) repose sur la procédure complète, qui ferme la console aux non-enrôlés.
    expect(router).toContain("const adminProcedure = tikisseAdminProcedure.use(");
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
    expect([...ADMIN_DOCUMENT_ROLES.kyc]).toEqual(["super_admin", "support", "kyc_reviewer"]);
    expect([...ADMIN_DOCUMENT_ROLES.report]).toEqual(["super_admin", "support"]);
    expect(read("admin/src/pages/KycPage.tsx")).toContain('const canReview = admin?.role === "super_admin" || admin?.role === "support" || admin?.role === "kyc_reviewer";');
  });

  it("le proxy public filtre avant toute autre étape, et la route admin est montée", () => {
    const proxy = read("server/_core/storageProxy.ts");
    expect(proxy.indexOf("isPrivateStorageKey(key)")).toBeLessThan(proxy.indexOf("ENV.forgeApiUrl"));
    expect(read("server/_core/index.ts")).toContain("registerAdminDocumentRoutes(app);");
  });
});

describe("lot 5 — traçabilité et pilotage", () => {
  const router = read("server/admin-router.ts");

  it("toutes les procédures du routeur admin passent par la trace d'audit préalable", () => {
    const body = router.slice(router.indexOf("export const tikisseAdminRouter"));
    expect(body).not.toContain("tikisseAdminProcedure");
  });

  it("masque mots de passe, codes et jetons dans l'entrée recopiée", async () => {
    const { auditableInput } = await import("../server/admin-router");
    expect(auditableInput({ password: "x", code: "123456", nested: { sessionToken: "t", amount: 5 }, list: [{ secret: "s" }] }))
      .toEqual({ password: "[masqué]", code: "[masqué]", nested: { sessionToken: "[masqué]", amount: 5 }, list: [{ secret: "[masqué]" }] });
  });

  it("les réglages gardent leur valeur avant et après", () => {
    for (const action of ["commission_rate_updated", "referral_settings_updated", "finance_settings_updated", "pricing_config_updated", "country_upserted", "country_enabled_changed", "maintenance_mode_changed", "loyalty_program_upserted", "loyalty_program_toggled", "totp_policy_changed", "profile_status_changed", "profile_role_changed", "report_resolved"]) {
      const line = router.split("\n").find((candidate) => candidate.includes(`"${action}"`));
      expect(line, action).toMatch(/before/);
    }
  });

  it("le journal affiche avant/après et propose les demandes brutes", () => {
    const page = read("admin/src/pages/AuditLogPage.tsx");
    expect(page).toContain("<AuditDetails details={row.details} />");
    expect(page).toContain("includeRequests");
  });

  it("un push de décision KYC ouvre l'écran Vérification de l'app", () => {
    const runtime = read("components/tikisse/push-notification-runtime.tsx");
    expect(runtime).toContain('if (data.screen === "verification") {');
    expect(runtime).toContain('router.push("/verification" as never);');
    expect(read("server/admin-db.ts")).toContain('data: { kind: "kyc_decision", screen: "verification" }');
  });

  it("les signalements clos se rouvrent avant un autre verdict, et l'auteur reçoit le message qui lui est destiné", () => {
    const page = read("admin/src/pages/ReportsPage.tsx");
    expect(page).toContain("Rouvrir");
    expect(page).toContain("replyToReporter: reply.trim() || undefined");
  });

  it("le tableau de bord affiche le revenu net et plafonne le taux de complétion", () => {
    const page = read("admin/src/pages/DashboardPage.tsx");
    expect(page).toContain('label="Commissions nettes"');
    expect(page).toContain("Math.min(100,");
  });

  it("l'historique des transactions se filtre, se cherche et se pagine", () => {
    const page = read("admin/src/pages/FinancePage.tsx");
    expect(page).toContain('onClick={() => setTab("history")}>Historique</button>');
    expect(page).toContain("offset: historyPage * HISTORY_PAGE_SIZE");
    expect(page).toContain('expired: "Expirée"');
  });
});

describe("lot A — contrôle financier", () => {
  const page = read("admin/src/pages/FinanceControlPage.tsx");

  it("l'écran n'apparaît qu'à super-admin et finance, comme les routes", () => {
    expect(read("admin/src/App.tsx")).toContain('{ key: "control", label: "Contrôle financier", href: "/admin/control", icon: "⊜", group: "finance", roles: ["super_admin", "finance"] }');
    const router = read("server/admin-router.ts");
    const control = router.slice(router.indexOf("control: router({"), router.indexOf("sendBonus:"));
    expect(control.match(/adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "finance"\)\)/g)).toHaveLength(5);
  });

  it("les fournisseurs simulés sont les mêmes que côté serveur", async () => {
    const { YENGAPAY_TEST_PROVIDERS } = await import("../server/yengapay");
    const declared = /const SIMULATED_PROVIDERS = (\[[^\]]*\]);/.exec(page)?.[1];
    expect(JSON.parse(declared ?? "[]")).toEqual([...YENGAPAY_TEST_PROVIDERS]);
  });

  it("une relance passe par une confirmation, l'export passe par le CSV neutralisé", () => {
    expect(page).toContain("onClick={() => setPendingReplay(row)}>Relancer</button>");
    expect(page).toContain("const csv = rowsToCsv([");
  });

  it("la réception et la relance d'un webhook partagent le même règlement", () => {
    const handler = read("server/yengapay-webhook.ts");
    expect(handler.match(/settleRecordedEvent\(event, /g)).toHaveLength(2);
  });

  it("la migration ajoute le montant annoncé par YengaPay", () => {
    expect(read("drizzle/manual/0046_payment_reported_amount.sql")).toContain("ADD COLUMN IF NOT EXISTS `providerReportedAmount` int DEFAULT NULL");
  });
});

describe("tableaux défilants", () => {
  it("un tableau dans un conteneur défilant n'a pas son en-tête décalé sur les premières lignes", () => {
    expect(read("admin/src/styles.css")).toContain(".table-scroll .table th { top: 0; }");
    for (const page of ["admin/src/pages/FinanceControlPage.tsx", "admin/src/pages/FinancePage.tsx"]) {
      expect(read(page), page).not.toContain('style={{ overflowX: "auto" }}');
    }
  });
});

describe("chaque entrée du menu affiche une page", () => {
  it("toute clé de navigation a son rendu dans la console", () => {
    const app = read("admin/src/App.tsx");
    const keys = [...app.matchAll(/\{ key: "([a-zA-Z]+)", label:/g)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) expect(app, key).toContain(`{activePage === "${key}" ? <`);
  });
});

describe("lot B — gouvernance", () => {
  it("rôles restreints : lecture seule ne modifie rien, KYC seul ne voit que le KYC, chacun garde son compte", async () => {
    const { isAdminPathAllowed } = await import("../shared/admin-roles");
    expect(isAdminPathAllowed("viewer", "dashboard.metrics", "query")).toBe(true);
    expect(isAdminPathAllowed("viewer", "maintenance.set", "mutation")).toBe(false);
    expect(isAdminPathAllowed("viewer", "auth.changePassword", "mutation")).toBe(true);
    expect(isAdminPathAllowed("kyc_reviewer", "kyc.review", "mutation")).toBe(true);
    expect(isAdminPathAllowed("kyc_reviewer", "users.search", "query")).toBe(false);
    expect(isAdminPathAllowed("kyc_reviewer", "auth.sessions.list", "query")).toBe(true);
    expect(isAdminPathAllowed("finance", "finance.sendBonus", "mutation")).toBe(true);
  });

  it("la garde des rôles restreints s'applique dans le middleware commun, pas procédure par procédure", () => {
    expect(read("server/_core/trpc.ts")).toContain("if (!isAdminPathAllowed(opts.ctx.tikisseAdmin.role, opts.path, opts.type)) {");
  });

  it("la console connaît les mêmes rôles que le serveur", async () => {
    const { ADMIN_ROLES } = await import("../shared/admin-roles");
    const auth = read("admin/src/lib/auth.tsx");
    const declared = /export type AdminRole = ([^;]+);/.exec(auth)?.[1] ?? "";
    expect(declared.split("|").map((part) => part.trim().replace(/"/g, ""))).toEqual([...ADMIN_ROLES]);
    const schema = read("drizzle/schema.ts");
    const adminTable = schema.slice(schema.indexOf('mysqlTable("tikisse_admin_users"'));
    const schemaRoles = /role: mysqlEnum\("role", (\[[^\]]*\])\)/.exec(adminTable)?.[1];
    expect(JSON.parse(schemaRoles ?? "[]")).toEqual([...ADMIN_ROLES]);
  });

  it("mot de passe provisoire ou rôle KYC seul : la navigation se restreint comme le serveur", () => {
    const app = read("admin/src/App.tsx");
    expect(app).toContain("const setupPending = admin.mustEnrollTotp || admin.mustChangePassword;");
    expect(app).toContain('NAV.filter((item) => item.key === "kyc" || item.key === "account")');
    expect(app).toContain('{ key: "approvals", label: "Validations", href: "/admin/approvals", icon: "⇄", group: "finance", roles: ["super_admin", "finance"] }');
  });

  it("les montants au-delà du seuil passent par une demande, partout où l'argent bouge", () => {
    const router = read("server/admin-router.ts");
    expect(router.match(/approvals\.requestWalletAdjustment\(/g)).toHaveLength(3); // users.reward, users.penalize, finance.sendBonus
    expect(router).toContain("approvals.requestWithdrawalSettlement(");
    for (const page of ["admin/src/pages/FinancePage.tsx", "admin/src/pages/UsersPage.tsx"]) {
      expect(read(page), page).toContain('"approvalRequired" in result');
    }
  });

  it("le journal se filtre et s'exporte ; la migration crée la gouvernance", () => {
    const page = read("admin/src/pages/AuditLogPage.tsx");
    expect(page).toContain("trpc.adminConsole.auditLog.export.query(queryFilters())");
    const migration = read("drizzle/manual/0047_admin_governance.sql");
    expect(migration).toContain("enum('super_admin','support','finance','viewer','kyc_reviewer')");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS `tikisse_admin_approvals`");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS `adminApprovalThreshold` int NOT NULL DEFAULT 100000");
  });
});

describe("lot C — litiges et avis", () => {
  it("dédommagements : rattachés à la livraison, soumis au seuil, idempotents", () => {
    const router = read("server/admin-router.ts");
    expect(router).toContain("approvals.requestDeliveryRefund(");
    expect(router).toMatch(/refund: adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "finance"\)\)/);
    expect(router).toMatch(/refundCommission: adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "finance"\)\)/);
    expect(router).toMatch(/removeDriver: adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "support"\)\)/);
    expect(router).toMatch(/complete: adminProcedure\.use\(requireTikisseAdminRole\("super_admin", "support"\)\)/);
    const disputes = read("server/admin-disputes.ts");
    expect(disputes).toContain('operation: "refund"');
    expect(disputes).toContain("await assertParticipant(tx, input.deliveryId, input.phone);");
    expect(read("server/admin-approvals.ts")).toContain('if (approval.action === "delivery_refund") return adminDisputeRefund(');
    expect(read("admin/src/pages/DisputeActions.tsx")).toContain("result.approvalRequired");
  });

  it("un avis masqué ne compte ni dans la note ni dans l'affichage côté livreur", () => {
    const db = read("server/db.ts");
    expect(db.match(/isNull\(tikisseDeliveryReviews\.hiddenAt\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("server/admin-disputes.ts")).toContain("Indiquez pourquoi cet avis est masqué.");
  });

  it("la migration ajoute la modération et la nouvelle action à valider", () => {
    const migration = read("drizzle/manual/0048_disputes_and_reviews.sql");
    expect(migration).toContain("`hiddenAt`");
    expect(migration).toContain("'delivery_refund'");
    expect(read("admin/src/pages/ApprovalsPage.tsx")).toContain('delivery_refund: "Dédommagement (litige)"');
  });
});

describe("lot D — utilisateurs", () => {
  it("la déconnexion forcée vaut pour tout jeton, vérifiée à la création du contexte", () => {
    const context = read("server/_core/context.ts");
    expect(context).toContain("if (profile && isRevokedByProfile(claims.issuedAt, profile.sessionsRevokedAt)) return null;");
    expect(read("server/tikisse-session.ts")).toContain("return issuedAt < Math.floor(sessionsRevokedAt.getTime() / 1000);");
  });

  it("le blocage par numéro est en base, levable depuis la console ; le nettoyage reste dans sa limite", () => {
    const routers = read("server/routers.ts");
    expect(routers).not.toContain("perPhoneBuckets");
    expect(routers).toContain("await db.checkPhoneAttemptLimit(scope, phone)");
    expect(read("server/db.ts")).toContain("like(tikisseRateLimits.rateLimitKey, `${scope}:%`)");
  });

  it("la suppression définitive passe par les blocages, efface les pièces et pseudonymise", () => {
    const deletions = read("server/admin-deletions.ts");
    expect(deletions).toContain("if (blockers.length > 0) throw new DeletionBlockedError(blockers);");
    expect(deletions).toContain("documentsErasedAt: now");
    expect(deletions).toContain("await pseudonymizePhone(tx, phone, pseudonym);");
    expect(read("server/_core/index.ts")).toContain("await runAccountDeletionJobs()");
    expect(read("server/db.ts")).not.toContain("export async function finalizeExpiredAccountDeletions");
  });

  it("la migration crée notes, correspondances et file d'effacement", () => {
    const migration = read("drizzle/manual/0049_user_support_and_deletion.sql");
    for (const fragment of ["`sessionsRevokedAt`", "CREATE TABLE IF NOT EXISTS `tikisse_profile_notes`", "CREATE TABLE IF NOT EXISTS `tikisse_deleted_accounts`", "CREATE TABLE IF NOT EXISTS `tikisse_storage_erasures`", "`documentsErasedAt`", "'manual_payout'"]) {
      expect(migration).toContain(fragment);
    }
  });
});
