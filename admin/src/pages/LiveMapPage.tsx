import { useEffect, useMemo, useState } from "react";
import { trpc } from "../lib/trpc";

type LiveLocation = {
  deliveryId: string;
  driverPhone: string;
  latitude: number;
  longitude: number;
  heading: number;
  recordedAt: string;
  updatedAt: string;
};

const MAP_WIDTH = 760;
const MAP_HEIGHT = 460;
const PADDING_PCT = 0.18;

function projectToMapPercent(point: { latitude: number; longitude: number }, bounds: { minLat: number; maxLat: number; minLng: number; maxLng: number }) {
  const latRange = bounds.maxLat - bounds.minLat || 0.0001;
  const lngRange = bounds.maxLng - bounds.minLng || 0.0001;
  const xPct = (point.longitude - bounds.minLng) / lngRange;
  const yPct = 1 - (point.latitude - bounds.minLat) / latRange;
  return { xPct: Math.max(0, Math.min(1, xPct)), yPct: Math.max(0, Math.min(1, yPct)) };
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "à l’instant";
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
}

function formatCoord(value: number) {
  return value.toFixed(5);
}

export default function LiveMapPage() {
  const [maxAge, setMaxAge] = useState(120);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const query = trpc.adminConsole.deliveriesOps.liveLocations.useQuery({ maxAgeSeconds: maxAge }, { refetchInterval: 10_000 });

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const locations = (query.data ?? []) as LiveLocation[];

  const bounds = useMemo(() => {
    if (locations.length === 0) return null;
    const lats = locations.map((loc) => loc.latitude);
    const lngs = locations.map((loc) => loc.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latPad = (maxLat - minLat || 0.01) * PADDING_PCT;
    const lngPad = (maxLng - minLng || 0.01) * PADDING_PCT;
    return { minLat: minLat - latPad, maxLat: maxLat + latPad, minLng: minLng - lngPad, maxLng: maxLng + lngPad };
  }, [locations]);

  async function reload() {
    setError("");
    setLoading(true);
    try {
      await query.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Rechargement impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Carte temps réel</h1>
          <p className="page-sub">Positions GPS des livreurs (rafraîchies toutes les 10 secondes)</p>
        </div>
        <div className="page-actions">
          <label className="field-row" style={{ alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Position de moins de</span>
            <select className="input" value={maxAge} onChange={(event) => setMaxAge(Number(event.target.value))} style={{ width: 100 }}>
              <option value={30}>30 s</option>
              <option value={60}>1 min</option>
              <option value={120}>2 min</option>
              <option value={300}>5 min</option>
              <option value={600}>10 min</option>
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={reload} disabled={loading}>
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      <div className="card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border)" }}>
          <div>
            <strong>{locations.length}</strong> livreur{locations.length > 1 ? "s" : ""} en course
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted)" }}>Boussole : nord en haut · cap = 0°</div>
        </div>

        {locations.length === 0 ? (
          <div className="empty-state" style={{ padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>◎</div>
            Aucune position GPS récente. Les livreurs apparaîtront ici dès qu’une livraison active reçoit un point GPS (≤ {maxAge} s).
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: `${MAP_WIDTH} / ${MAP_HEIGHT}`, background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
              <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} style={{ width: "100%", height: "100%", display: "block" }}>
                <defs>
                  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                    <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" />
                  </pattern>
                </defs>
                <rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="url(#grid)" />
                {bounds ? (
                  locations.map((location) => {
                    const { xPct, yPct } = projectToMapPercent({ latitude: location.latitude, longitude: location.longitude }, bounds);
                    const cx = xPct * MAP_WIDTH;
                    const cy = yPct * MAP_HEIGHT;
                    const angle = location.heading;
                    return (
                      <g key={location.deliveryId} transform={`translate(${cx}, ${cy})`}>
                        <circle r="14" fill="var(--primary)" fillOpacity="0.15" />
                        <circle r="6" fill="var(--primary)" stroke="var(--surface)" strokeWidth="1.5" />
                        <line x1="0" y1="0" x2="0" y2="-16" stroke="var(--primary)" strokeWidth="1.5" transform={`rotate(${angle})`} />
                        <text x="10" y="-8" fontSize="10" fill="var(--foreground)">{formatRelative(location.updatedAt)}</text>
                      </g>
                    );
                  })
                ) : null}
              </svg>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8, marginTop: 12 }}>
              {locations.map((location) => (
                <div key={location.deliveryId} className="card" style={{ padding: 10, border: "1px solid var(--border)", background: "var(--surface-2)" }}>
                  <div style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase" }}>Course</div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{location.deliveryId.slice(0, 8)}…</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Livreur : {location.driverPhone}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Lat {formatCoord(location.latitude)} · Lng {formatCoord(location.longitude)}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>Cap {Math.round(location.heading)}° · MAJ {formatRelative(location.updatedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>Source : tRPC <code>adminConsole.deliveriesOps.liveLocations</code> · auto-refresh {tick} s</div>
    </div>
  );
}
