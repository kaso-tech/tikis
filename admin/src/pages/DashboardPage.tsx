import { useEffect, useState } from "react";
import { trpc } from "../lib/trpc";

type Metrics = {
  periodDays: number;
  deliveriesTotal: number;
  deliveriesCompleted: number;
  openReports: number;
  activeDrivers: number;
  commissionRevenue: number;
};

function formatMoney(amount: number) {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    trpc.adminConsole.dashboard.metrics.query({ periodDays: 30 })
      .then((data) => setMetrics(data as Metrics))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Impossible de charger le tableau de bord."));
  }, []);

  return (
    <div>
      <h1 className="page-title">Tableau de bord</h1>
      <p className="page-subtitle">Vue d’ensemble des 30 derniers jours.</p>
      {error ? <div className="error-banner">{error}</div> : null}
      {metrics ? (
        <div className="kpi-grid">
          <div className="kpi-card"><div className="kpi-label">Livraisons créées</div><div className="kpi-value">{metrics.deliveriesTotal}</div></div>
          <div className="kpi-card"><div className="kpi-label">Livraisons terminées</div><div className="kpi-value">{metrics.deliveriesCompleted}</div></div>
          <div className="kpi-card"><div className="kpi-label">Livreurs actifs</div><div className="kpi-value">{metrics.activeDrivers}</div></div>
          <div className="kpi-card"><div className="kpi-label">Revenu commissions</div><div className="kpi-value">{formatMoney(metrics.commissionRevenue)}</div></div>
          <div className="kpi-card"><div className="kpi-label">Signalements ouverts</div><div className="kpi-value" style={{ color: metrics.openReports > 0 ? "var(--danger)" : undefined }}>{metrics.openReports}</div></div>
        </div>
      ) : !error ? <p className="page-subtitle">Chargement…</p> : null}
      <div className="card">
        <p className="card-title">Prise en main rapide</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          Utilisez <strong>Signalements</strong> pour traiter les cas envoyés par les Senders et Livreurs (CAS N°9),
          et <strong>Litiges</strong> pour consulter la chronologie complète d’une livraison — candidatures, mouvements
          financiers, notifications — avant toute décision (CAS N°10). Toute action prise ici est enregistrée dans le
          <strong> journal d’audit</strong>, consultable par les super-administrateurs.
        </p>
      </div>
    </div>
  );
}
