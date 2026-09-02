import { useState } from "react";
import { AdminAuthProvider, useAdminAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CommissionPage from "./pages/CommissionPage";
import ReportsPage from "./pages/ReportsPage";
import DisputesPage from "./pages/DisputesPage";
import UsersPage from "./pages/UsersPage";
import KycPage from "./pages/KycPage";
import LiveMapPage from "./pages/LiveMapPage";
import SettingsPage from "./pages/SettingsPage";
import AdminsPage from "./pages/AdminsPage";
import AuditLogPage from "./pages/AuditLogPage";

type PageKey = "dashboard" | "map" | "reports" | "disputes" | "users" | "kyc" | "commission" | "settings" | "admins" | "auditLog";
type GroupKey = "ops" | "people" | "trust" | "system";

const NAV: { key: PageKey; label: string; href: string; icon: string; group: GroupKey; roles?: Array<"super_admin" | "support" | "finance"> }[] = [
  { key: "dashboard", label: "Vue d'ensemble", href: "/admin", icon: "▦", group: "ops" },
  { key: "map", label: "Carte temps réel", href: "/admin/map", icon: "◎", group: "ops" },
  { key: "reports", label: "Signalements", href: "/admin/reports", icon: "⚐", group: "ops" },
  { key: "disputes", label: "Litiges", href: "/admin/disputes", icon: "⚖", group: "trust" },
  { key: "users", label: "Utilisateurs", href: "/admin/users", icon: "◉", group: "people" },
  { key: "kyc", label: "Validations KYC", href: "/admin/kyc", icon: "✓", group: "people" },
  { key: "commission", label: "Commission", href: "/admin/commission", icon: "₣", group: "trust", roles: ["super_admin", "finance"] },
  { key: "settings", label: "Paramètres", href: "/admin/settings", icon: "⚙", group: "system", roles: ["super_admin"] },
  { key: "admins", label: "Équipe admin", href: "/admin/admins", icon: "★", group: "system", roles: ["super_admin"] },
  { key: "auditLog", label: "Journal d'audit", href: "/admin/audit", icon: "▤", group: "system", roles: ["super_admin"] },
];

const GROUP_LABELS: Record<GroupKey, string> = {
  ops: "Opérations",
  people: "Personnes",
  trust: "Confiance & finance",
  system: "Système",
};
const GROUP_ORDER: GroupKey[] = ["ops", "people", "trust", "system"];

function NavIcon({ glyph }: { glyph: string }) {
  return <span className="sidebar-link-icon">{glyph}</span>;
}

function Shell() {
  const { admin, logout } = useAdminAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [search, setSearch] = useState("");
  if (!admin) return null;

  const visibleNav = NAV.filter((item) => !item.roles || item.roles.includes(admin.role));
  const grouped = visibleNav.reduce<Record<GroupKey, typeof visibleNav>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, { ops: [], people: [], trust: [], system: [] });

  const currentLabel = visibleNav.find((item) => item.key === page)?.label ?? "Console";
  const currentGroup = visibleNav.find((item) => item.key === page)?.group ?? "ops";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-mark">T</div>
          <div className="sidebar-brand-text">
            <div className="sidebar-brand-title">Tikis Admin</div>
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
                    className={`sidebar-link ${page === item.key ? "active" : ""}`}
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
            <div className="sidebar-user-role">{admin.role.replace("_", " ")}</div>
          </div>
          <button className="sidebar-logout" onClick={logout} title="Se déconnecter">⏻</button>
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
            <button className="icon-btn" title="Notifications"><span>◔</span><span className="dot" /></button>
          </div>
        </header>
        <main className="main">
          {page === "dashboard" ? <DashboardPage search={search} /> : null}
          {page === "map" ? <LiveMapPage /> : null}
          {page === "reports" ? <ReportsPage /> : null}
          {page === "disputes" ? <DisputesPage /> : null}
          {page === "users" ? <UsersPage search={search} /> : null}
          {page === "kyc" ? <KycPage /> : null}
          {page === "commission" ? <CommissionPage /> : null}
          {page === "settings" ? <SettingsPage /> : null}
          {page === "admins" ? <AdminsPage /> : null}
          {page === "auditLog" ? <AuditLogPage /> : null}
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
