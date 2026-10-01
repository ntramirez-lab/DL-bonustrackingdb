import { getBonusMetrics, type CsmMetric, type MetricSection } from "@/lib/metrics";
import { resolveWindow } from "@/lib/window";

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
  section,
  unit,
  decimals,
  emptyNote = "No records in this window.",
}: {
  title: string;
  section: MetricSection;
  unit?: string;
  decimals?: number;
  emptyNote?: string;
}) {
  return (
    <section className="section">
      <h2>{title}</h2>
      {section.error ? (
        <div className="gap-card">
          <strong>Couldn&apos;t load this metric.</strong> {section.error}
        </div>
      ) : section.rows.length === 0 ? (
        <div className="gap-card">{emptyNote}</div>
      ) : (
        <div className="tile-grid">
          {section.rows.map((m) => (
            <Tile key={m.csm} metric={m} unit={unit} decimals={decimals} />
          ))}
        </div>
      )}
    </section>
  );
}

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const quarter = Number.parseInt(one(params.quarter) ?? "0", 10) || 0;
  const { windowStart, windowEnd } = resolveWindow({
    from: one(params.from),
    to: one(params.to),
    quarter: String(quarter),
  });
  const metrics = await getBonusMetrics(windowStart, windowEnd);

  return (
    <main className="page">
      <div className="page-header">
        <h1>CSM Bonus Tracking</h1>
        <p>
          Data source: {metrics.source === "mock" ? "mock (Salesforce not configured — see .env.example)" : "Salesforce"}
          {" · "}
          {metrics.windowStart} to {metrics.windowEnd} (end exclusive)
          {" · "}generated {new Date(metrics.generatedAt).toLocaleString()}
        </p>
        <p>
          <a href={`?quarter=${quarter - 1}`}>← Previous quarter</a>
          {quarter < 0 && (
            <>
              {" · "}
              <a href={`?quarter=${quarter + 1}`}>Next quarter →</a>
            </>
          )}
        </p>
      </div>

      <TileSection title="Logo churn (lower is better)" section={metrics.logoChurn} />
      <TileSection title="Net monthly → annual conversions" section={metrics.netConversions} />
      <TileSection
        title="QBR coverage"
        section={metrics.qbrCoverage}
        emptyNote="No CX Events with category “Account Review” completed in this window. QBRs only count when logged under that category."
      />
      <TileSection title="NPS" section={metrics.nps} />
      <TileSection title="Save rate" section={metrics.saveRate} unit="%" />
      <TileSection
        title="CSAT"
        section={metrics.csat}
        decimals={1}
        emptyNote="No CSAT responses (survey CX-CSAT) in this window."
      />

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
