export default function KycPage() {
  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Validations KYC</h1>
          <p className="page-sub">File d'attente des livreurs en cours de vérification d'identité</p>
        </div>
      </div>
      <div className="card">
        <div className="empty-state">
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          Aucun livreur en attente de validation.
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
            Le flux KYC détaillé (CNI / selfie / permis) sera intégré à la prochaine itération.
          </div>
        </div>
      </div>
    </div>
  );
}
