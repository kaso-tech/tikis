type Props = {
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  className?: string;
  style?: React.CSSProperties;
};

export function Skeleton({ width = "100%", height = 12, circle = false, className = "", style }: Props) {
  const finalWidth = typeof width === "number" ? `${width}px` : width;
  const finalHeight = typeof height === "number" ? `${height}px` : height;
  return (
    <span
      className={`skeleton ${circle ? "skeleton-circle" : "skeleton-line"} ${className}`.trim()}
      style={{ width: finalWidth, height: finalHeight, ...style }}
      aria-hidden
    >
      &nbsp;
    </span>
  );
}

export function SkeletonKpiGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="kpi-grid">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="kpi">
          <Skeleton width={80} height={10} />
          <div style={{ marginTop: 8 }}>
            <Skeleton width={120} height={24} />
          </div>
          <div style={{ marginTop: 8 }}>
            <Skeleton width={160} height={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="skeleton-row">
          {Array.from({ length: columns }).map((_, c) => (
            <div key={c} style={{ flex: 1 }}>
              <Skeleton width={c === 0 ? "70%" : "90%"} height={11} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 120 }: { height?: number }) {
  return (
    <div className="skeleton-card">
      <Skeleton width="40%" height={11} />
      <div style={{ marginTop: 10 }}>
        <Skeleton width="80%" height={height - 40} />
      </div>
    </div>
  );
}
