import { useEffect, useState } from "react";
import { ADMIN_ROLE_LABELS, AdminAuthProvider, useAdminAuth, type AdminRole } from "./lib/auth";
import { trpc } from "./lib/trpc";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CommissionPage from "./pages/CommissionPage";
import ReportsPage from "./pages/ReportsPage";
import DisputesPage from "./pages/DisputesPage";
import DeliveriesPage from "./pages/DeliveriesPage";
import UsersPage from "./pages/UsersPage";
import KycPage from "./pages/KycPage";
import ReferralsPage from "./pages/ReferralsPage";
import FinancePage from "./pages/FinancePage";
import PricingPage from "./pages/PricingPage";
import LiveMapPage from "./pages/LiveMapPage";
import SettingsPage from "./pages/SettingsPage";
import AdminsPage from "./pages/AdminsPage";
import CountriesPage from "./pages/CountriesPage";
import MaintenancePage from "./pages/MaintenancePage";
import AuditLogPage from "./pages/AuditLogPage";
import LoyaltyPage from "./pages/LoyaltyPage";
import LoyaltyGrantsPage from "./pages/LoyaltyGrantsPage";
import AccountPage from "./pages/AccountPage";
import FinanceControlPage from "./pages/FinanceControlPage";
import ApprovalsPage from "./pages/ApprovalsPage";
import ReviewsPage from "./pages/ReviewsPage";
import AccountDeletionsPage from "./pages/AccountDeletionsPage";

type PageKey = "dashboard" | "map" | "reports" | "disputes" | "deliveries" | "users" | "kyc" | "referrals" | "finance" | "pricing" | "commission" | "countries" | "maintenance" | "settings" | "admins" | "auditLog" | "loyalty" | "loyaltyGrants" | "account" | "control" | "approvals" | "reviews" | "deletions";
type GroupKey = "ops" | "people" | "trust" | "finance" | "system";

const NAV: { key: PageKey; label: string; href: string; icon: string; group: GroupKey; roles?: AdminRole[] }[] = [
  { key: "dashboard", label: "Vue d'ensemble", href: "/admin", icon: "▦", group: "ops" },
  { key: "map", label: "Carte temps réel", href: "/admin/map", icon: "◎", group: "ops", roles: ["super_admin", "support"] },
  { key: "deliveries", label: "Livraisons", href: "/admin/deliveries", icon: "▣", group: "ops" },
  { key: "reports", label: "Signalements", href: "/admin/reports", icon: "⚐", group: "ops" },
  { key: "disputes", label: "Litiges", href: "/admin/disputes", icon: "⚖", group: "trust" },
  { key: "reviews", label: "Avis", href: "/admin/reviews", icon: "☆", group: "trust", roles: ["super_admin", "support"] },
  { key: "users", label: "Utilisateurs", href: "/admin/users", icon: "◉", group: "people" },
  { key: "kyc", label: "Validations KYC", href: "/admin/kyc", icon: "✓", group: "people" },
  { key: "referrals", label: "Parrainage", href: "/admin/referrals", icon: "◈", group: "people" },
  { key: "deletions", label: "Suppressions de compte", href: "/admin/deletions", icon: "⌫", group: "people", roles: ["super_admin", "support", "finance"] },
  { key: "finance", label: "Finance", href: "/admin/finance", icon: "$", group: "finance", roles: ["super_admin", "finance"] },
  { key: "approvals", label: "Validations", href: "/admin/approvals", icon: "⇄", group: "finance", roles: ["super_admin", "finance"] },
  { key: "control", label: "Contrôle financier", href: "/admin/control", icon: "⊜", group: "finance", roles: ["super_admin", "finance"] },
  { key: "commission", label: "Commission", href: "/admin/commission", icon: "₣", group: "finance", roles: ["super_admin", "finance"] },
  { key: "pricing", label: "Estimation intelligente", href: "/admin/pricing", icon: "≈", group: "finance", roles: ["super_admin", "finance"] },
  { key: "countries", label: "Pays", href: "/admin/countries", icon: "◍", group: "system", roles: ["super_admin"] },
  { key: "maintenance", label: "Maintenance", href: "/admin/maintenance", icon: "⛭", group: "system", roles: ["super_admin"] },
  { key: "settings", label: "Paramètres", href: "/admin/settings", icon: "⚙", group: "system", roles: ["super_admin"] },
  { key: "admins", label: "Équipe admin", href: "/admin/admins", icon: "★", group: "system", roles: ["super_admin"] },
  { key: "auditLog", label: "Journal d'audit", href: "/admin/audit", icon: "▤", group: "system", roles: ["super_admin"] },
  { key: "loyalty", label: "Fidélité", href: "/admin/loyalty", icon: "♛", group: "finance", roles: ["super_admin", "finance"] },
  { key: "account", label: "Mon compte", href: "/admin/account", icon: "✱", group: "system" },
  { key: "loyaltyGrants", label: "Octrois fidélité", href: "/admin/loyalty-grants", icon: "⚇", group: "finance", roles: ["super_admin", "finance"] },
];

const GROUP_LABELS: Record<GroupKey, string> = {
  ops: "Opérations",
  people: "Personnes",
  trust: "Confiance",
  finance: "Finance",
  system: "Système",
};
const GROUP_ORDER: GroupKey[] = ["ops", "people", "trust", "finance", "system"];

function NavIcon({ glyph }: { glyph: string }) {
  return <span className="sidebar-link-icon">{glyph}</span>;
}

const OPEN_REPORTS_POLL_MS = 30_000;

function Shell() {
  const { admin, logout } = useAdminAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [search, setSearch] = useState("");
  const [openReportsCount, setOpenReportsCount] = useState(0);
  useEffect(() => {
    // Avant ce correctif, un nouveau signalement n'était visible qu'en rechargeant la page Tableau de
    // bord : aucune notification. Le bouton "Notifications" de la barre du haut affichait un point fixe,
    // sans donnée réelle. Un sondage léger suffit ici (pas besoin de temps réel pour ce cas d'usage admin).
    // Rien à sonder tant que le compte n'est pas prêt, ni pour le rôle « KYC seul » : le serveur refuserait.
    if (!admin || admin.mustChangePassword || admin.mustEnrollTotp || admin.role === "kyc_reviewer") return;
    let cancelled = false;
    async function poll() {
      try {
        const openReports = await trpc.adminConsole.reports.list.query({ status: "open" });
        if (!cancelled) setOpenReportsCount(Array.isArray(openReports) ? openReports.length : 0);
      } catch { /* ignore : la prochaine tentative réessaiera */ }
    }
    void poll();
    const interval = setInterval(() => void poll(), OPEN_REPORTS_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [admin?.mustChangePassword, admin?.mustEnrollTotp, admin?.role]);
  useEffect(() => {
    function onNavigate(event: Event) {
      const custom = event as CustomEvent<{ page: PageKey }>;
      if (custom.detail?.page) setPage(custom.detail.page);
    }
    window.addEventListener("tikisse:navigate", onNavigate as EventListener);
    return () => window.removeEventListener("tikisse:navigate", onNavigate as EventListener);
  }, []);
  if (!admin) return null;

  // Double authentification exigée et pas encore activée : le serveur refuse tout le reste, la console
  // ne montre que « Mon compte ».
  // Mot de passe provisoire à changer : même règle. Rôle « KYC seul » : les vérifications et son compte.
  const setupPending = admin.mustEnrollTotp || admin.mustChangePassword;
  const visibleNav = setupPending
    ? NAV.filter((item) => item.key === "account")
    : admin.role === "kyc_reviewer"
      ? NAV.filter((item) => item.key === "kyc" || item.key === "account")
      : NAV.filter((item) => !item.roles || item.roles.includes(admin.role));
  const activePage: PageKey = setupPending ? "account" : visibleNav.some((item) => item.key === page) ? page : visibleNav[0]?.key ?? "account";
  const grouped = visibleNav.reduce<Record<GroupKey, typeof visibleNav>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, { ops: [], people: [], trust: [], finance: [], system: [] });

  const currentLabel = visibleNav.find((item) => item.key === activePage)?.label ?? "Console";
  const currentGroup = visibleNav.find((item) => item.key === activePage)?.group ?? "ops";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">T</div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">Tikisse Admin</div>
            <div className="sidebar-brand-sub">Console opérateur</div>
          </div>
        </div>
        <div className="sidebar-nav">
          {GROUP_ORDER.map((group) => {
            const items = grouped[group];
            if (items.length === 0) return null;
            return (
              <div key={group} className="sidebar-group">
                <div className="sidebar-group-label">{GROUP_LABELS[group]}</div>
                {items.map((item) => (
                  <button
                    key={item.key}
                    className={`sidebar-link ${activePage === item.key ? "active" : ""}`}
                    onClick={() => setPage(item.key)}
                  >
                    <NavIcon glyph={item.icon} />
                    <span className="sidebar-link-label">{item.label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-avatar">{initials(admin.email)}</div>
          <div className="sidebar-user">
            <div className="sidebar-user-email" title={admin.email}>{admin.email}</div>
            <div className="sidebar-user-role">{ADMIN_ROLE_LABELS[admin.role] ?? admin.role}</div>
          </div>
          <button className="sidebar-logout" onClick={() => void logout()} title="Se déconnecter">⏻</button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <div className="crumbs">
            <span>{GROUP_LABELS[currentGroup]}</span>
            <span className="sep">/</span>
            <span className="here">{currentLabel}</span>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-search">
            <span>⌕</span>
            <input placeholder="Rechercher une livraison, un profil, un ID…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="kbd">⌘K</span>
          </div>
          <div className="topbar-actions">
            <button className="icon-btn" title="Thème">◐</button>
            <button
              className="icon-btn"
              title={openReportsCount > 0 ? `${openReportsCount} signalement${openReportsCount > 1 ? "s" : ""} ouvert${openReportsCount > 1 ? "s" : ""}` : "Aucun signalement ouvert"}
              onClick={() => setPage("reports")}
            >
              <span>◔</span>
              {openReportsCount > 0 ? <span className="dot" /> : null}
            </button>
          </div>
        </header>
        <main className="main">
          {activePage === "account" ? <AccountPage /> : null}
          {setupPending ? null : <>
          {activePage === "dashboard" ? <DashboardPage search={search} /> : null}
          {activePage === "map" ? <LiveMapPage /> : null}
          {activePage === "deliveries" ? <DeliveriesPage /> : null}
          {activePage === "reports" ? <ReportsPage /> : null}
          {activePage === "disputes" ? <DisputesPage /> : null}
          {activePage === "reviews" ? <ReviewsPage /> : null}
          {activePage === "deletions" ? <AccountDeletionsPage /> : null}
          {activePage === "users" ? <UsersPage search={search} /> : null}
          {activePage === "kyc" ? <KycPage /> : null}
          {activePage === "referrals" ? <ReferralsPage /> : null}
          {activePage === "finance" ? <FinancePage /> : null}
          {activePage === "control" ? <FinanceControlPage /> : null}
          {activePage === "approvals" ? <ApprovalsPage /> : null}
          {activePage === "pricing" ? <PricingPage /> : null}
          {activePage === "commission" ? <CommissionPage /> : null}
          {activePage === "countries" ? <CountriesPage /> : null}
          {activePage === "maintenance" ? <MaintenancePage /> : null}
          {activePage === "settings" ? <SettingsPage /> : null}
          {activePage === "admins" ? <AdminsPage /> : null}
          {activePage === "auditLog" ? <AuditLogPage /> : null}
          {activePage === "loyalty" ? <LoyaltyPage /> : null}
          {activePage === "loyaltyGrants" ? <LoyaltyGrantsPage /> : null}
          </>}
        </main>
      </div>
    </div>
  );
}

function initials(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase();
}

function Gate() {
  const { admin, loading } = useAdminAuth();
  if (loading) {
    return (
      <div className="login-page">
        <div className="login-card" style={{ textAlign: "center", color: "var(--muted)" }}>Chargement…</div>
      </div>
    );
  }
  return admin ? <Shell /> : <LoginPage />;
}

export default function App() {
  return (
    <AdminAuthProvider>
      <Gate />
    </AdminAuthProvider>
  );
}
