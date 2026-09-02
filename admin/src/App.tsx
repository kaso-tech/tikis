import { useState } from "react";
import { AdminAuthProvider, useAdminAuth } from "./lib/auth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CommissionPage from "./pages/CommissionPage";
import ReportsPage from "./pages/ReportsPage";
import DisputesPage from "./pages/DisputesPage";
import UsersPage from "./pages/UsersPage";
import AdminsPage from "./pages/AdminsPage";
import AuditLogPage from "./pages/AuditLogPage";

type PageKey = "dashboard" | "reports" | "disputes" | "users" | "commission" | "admins" | "auditLog";

const NAV: { key: PageKey; label: string; roles?: Array<"super_admin" | "support" | "finance"> }[] = [
  { key: "dashboard", label: "Tableau de bord" },
  { key: "reports", label: "Signalements" },
  { key: "disputes", label: "Litiges" },
  { key: "users", label: "Utilisateurs" },
  { key: "commission", label: "Commission" },
  { key: "admins", label: "Équipe admin", roles: ["super_admin"] },
  { key: "auditLog", label: "Journal d’audit", roles: ["super_admin"] },
];

function Shell() {
  const { admin, logout } = useAdminAuth();
  const [page, setPage] = useState<PageKey>("dashboard");
  if (!admin) return null;

  const visibleNav = NAV.filter((item) => !item.roles || item.roles.includes(admin.role));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Tikis Admin</div>
        <nav className="sidebar-nav">
          {visibleNav.map((item) => (
            <button key={item.key} className={`sidebar-link ${page === item.key ? "active" : ""}`} onClick={() => setPage(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">{admin.email}</div>
          <div className="sidebar-role">{admin.role.replace("_", " ")}</div>
          <button className="sidebar-logout" onClick={logout}>Se déconnecter</button>
        </div>
      </aside>
      <main className="main">
        {page === "dashboard" ? <DashboardPage /> : null}
        {page === "reports" ? <ReportsPage /> : null}
        {page === "disputes" ? <DisputesPage /> : null}
        {page === "users" ? <UsersPage /> : null}
        {page === "commission" ? <CommissionPage /> : null}
        {page === "admins" && admin.role === "super_admin" ? <AdminsPage /> : null}
        {page === "auditLog" && admin.role === "super_admin" ? <AuditLogPage /> : null}
      </main>
    </div>
  );
}

function Gate() {
  const { admin, loading } = useAdminAuth();
  if (loading) return <div className="login-page"><p style={{ color: "#fff" }}>Chargement…</p></div>;
  return admin ? <Shell /> : <LoginPage />;
}

export default function App() {
  return (
    <AdminAuthProvider>
      <Gate />
    </AdminAuthProvider>
  );
}
