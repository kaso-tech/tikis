export default function LiveMapPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Carte temps réel</h1>
          <p className="page-sub">Courses actives avec position GPS des livreurs</p>
        </div>
      </div>
      <div className="card map-card">
        <div style={{ padding: 16 }}>
          <div className="empty-state">
            <div style={{ fontSize: 32, marginBottom: 8 }}>◎</div>
            La carte temps réel (Mapbox + projection bounding box) sera intégrée dès que le service de tracking est activé en production.
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
              Endpoint backend disponible : <code>trpc.adminConsole.deliveriesOps.list</code> filtré par statut <code>active</code> / <code>pending_confirmation</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
