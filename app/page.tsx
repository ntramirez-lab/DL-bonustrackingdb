import { getBonusMetrics, type CsmMetric } from "@/lib/metrics";

function Tile({ metric, unit = "", decimals = 0 }: { metric: CsmMetric; unit?: string; decimals?: number }) {
  const label = { good: "On track", warning: "Watch", serious: "Behind", critical: "At risk" }[metric.status];
  return (
    <div className="tile">
      <span className="tile-csm">{metric.csm}</span>
      <span className="tile-value">
        {metric.value.toFixed(decimals)}
        {unit}
      </span>
      {metric.target !== undefined && (
        <span className="tile-target">
          target {metric.target.toFixed(decimals)}
          {unit}
        </span>
      )}
      <span className={`status-badge status-${metric.status}`}>
        <span className="status-dot" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

function TileSection({
  title,
  metrics,
  unit,
  decimals,
}: {
  title: string;
  metrics: CsmMetric[];
  unit?: string;
  decimals?: number;
}) {
  return (
    <section className="section">
      <h2>{title}</h2>
      <div className="tile-grid">
        {metrics.map((m) => (
          <Tile key={m.csm} metric={m} unit={unit} decimals={decimals} />
        ))}
      </div>
    </section>
  );
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const metrics = await getBonusMetrics(
    quarterStart.toISOString().slice(0, 10),
    now.toISOString().slice(0, 10)
  );

  return (
    <main className="page">
      <div className="page-header">
        <h1>CSM Bonus Tracking</h1>
        <p>
          Data source: {metrics.source === "mock" ? "mock (Salesforce not configured — see .env.example)" : "Salesforce"}
          {" · "}generated {new Date(metrics.generatedAt).toLocaleString()}
        </p>
      </div>

      <TileSection title="Logo churn (lower is better)" metrics={metrics.logoChurn} />
      <TileSection title="Net monthly → annual conversions" metrics={metrics.netConversions} />
      <TileSection title="QBR coverage" metrics={metrics.qbrCoverage} />
      <TileSection title="NPS" metrics={metrics.nps} />
      <TileSection title="Save rate" metrics={metrics.saveRate} unit="%" />
      <TileSection title="CSAT" metrics={metrics.csat} decimals={1} />

      <section className="section">
        <h2>Meaningful connections / Zoom minutes</h2>
        <div className="gap-card">
          <strong>Not wired up yet.</strong> {metrics.meaningfulConnections.note}
          <ul>
            {metrics.meaningfulConnections.candidates.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </section>

      <p className="footer-note">
        Field mapping: GTM-2496 · Dashboard: GTM-2495 · Metric source-of-truth is the salesforce repo&apos;s
        force-app/main/default/objects metadata — re-check there if a query here stops matching prod.
      </p>
    </main>
  );
}
