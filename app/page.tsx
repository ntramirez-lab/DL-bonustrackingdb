import { getBonusMetrics, type CsmMetric, type MetricSection } from "@/lib/metrics";
import {
  addDays,
  monthWindow,
  quarterWindow,
  resolveWindow,
  yearToDateWindow,
  type ReportWindow,
} from "@/lib/window";

const fmt = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function presets(): { label: string; window: ReportWindow }[] {
  return [
    { label: "This quarter", window: quarterWindow(0) },
    { label: "Last quarter", window: quarterWindow(-1) },
    { label: "This month", window: monthWindow(0) },
    { label: "Last month", window: monthWindow(-1) },
    { label: "Year to date", window: yearToDateWindow() },
  ];
}

const presetHref = ({ windowStart, windowEnd }: ReportWindow) =>
  `?from=${windowStart}&through=${addDays(windowEnd, -1)}`;

const STATUS_LABEL: Record<CsmMetric["status"], string> = {
  good: "On track",
  warning: "Watch",
  serious: "Behind",
  critical: "At risk",
};

function Info({ text }: { text: string }) {
  return (
    <span className="info" title={text} aria-label={text} role="img">
      i
    </span>
  );
}

// --- Team summary (big coloured cards) --------------------------------------

interface Summary {
  label: string;
  value: string;
  sub: string;
  tone: "navy" | "blue" | "neon" | "ink";
}

const sum = (s: MetricSection) => s.rows.reduce((acc, r) => acc + r.value, 0);

// Ratio metrics are pooled from their parts, never averaged across CSMs.
function pooled(s: MetricSection, noun: string): { value: string; sub: string } {
  const num = s.rows.reduce((acc, r) => acc + (r.parts?.num ?? 0), 0);
  const den = s.rows.reduce((acc, r) => acc + (r.parts?.den ?? 0), 0);
  if (den === 0) return { value: "—", sub: "no data in this period" };
  return { value: `${Math.round((num / den) * 100)}%`, sub: `${num.toLocaleString()} of ${den.toLocaleString()} ${noun}` };
}

function teamSummary(m: Awaited<ReturnType<typeof getBonusMetrics>>): Summary[] {
  const unavailable = (s: MetricSection) => !!s.error || s.rows.length === 0;
  const churn = sum(m.logoChurn);
  const net = sum(m.netConversions);
  const qbr = pooled(m.qbrCoverage, "active accounts");
  const save = pooled(m.saveRate, "requests saved");
  return [
    {
      label: "Logo churn",
      value: unavailable(m.logoChurn) ? "—" : churn.toLocaleString(),
      sub: "accounts canceled (lower is better)",
      tone: "navy",
    },
    {
      label: "Net monthly → annual",
      value: unavailable(m.netConversions) ? "—" : `${net > 0 ? "+" : ""}${net.toLocaleString()}`,
      sub: "upgrades minus downgrades",
      tone: "blue",
    },
    { label: "QBR coverage", ...qbr, tone: "neon" },
    { label: "Save rate", ...save, tone: "ink" },
  ];
}

function SummaryCard({ s }: { s: Summary }) {
  return (
    <div className={`kpi kpi-${s.tone}`}>
      <span className="kpi-label">{s.label}</span>
      <span className="kpi-value">{s.value}</span>
      <span className="kpi-sub">{s.sub}</span>
    </div>
  );
}

// --- Per-CSM panels ---------------------------------------------------------

function Tile({ metric, unit = "", decimals = 0 }: { metric: CsmMetric; unit?: string; decimals?: number }) {
  return (
    <div className="tile">
      <span className="tile-csm">{metric.csm}</span>
      <span className="tile-value">
        {metric.value.toFixed(decimals)}
        {unit}
      </span>
      {metric.detail && <span className="tile-meta">{metric.detail}</span>}
      {metric.target !== undefined && (
        <span className="tile-meta">
          target {metric.target.toFixed(decimals)}
          {unit}
        </span>
      )}
      <span className={`status-badge status-${metric.status}`}>
        <span className="status-dot" aria-hidden="true" />
        {STATUS_LABEL[metric.status]}
      </span>
    </div>
  );
}

function Panel({
  title,
  info,
  section,
  unit,
  decimals,
  emptyNote = "No records in this period.",
}: {
  title: string;
  info: string;
  section: MetricSection;
  unit?: string;
  decimals?: number;
  emptyNote?: string;
}) {
  return (
    <section className="panel">
      <h3>
        {title} <Info text={info} />
      </h3>
      {section.error ? (
        <div className="note">
          <strong>Couldn&apos;t load this metric.</strong> {section.error}
        </div>
      ) : section.rows.length === 0 ? (
        <div className="note">{emptyNote}</div>
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
  const { windowStart, windowEnd } = resolveWindow({
    from: one(params.from),
    to: one(params.to),
    through: one(params.through),
    quarter: one(params.quarter),
  });
  const through = addDays(windowEnd, -1);
  const metrics = await getBonusMetrics(windowStart, windowEnd);
  const live = metrics.source === "salesforce";
  const activePreset = presets().find(
    ({ window }) => window.windowStart === windowStart && window.windowEnd === windowEnd
  );
  const customRange = !activePreset;

  return (
    <>
      <div className="topbar">
        <strong>CSM Bonus Tracking</strong> · {live ? "live numbers from Salesforce" : "sample numbers until Salesforce is connected"}
      </div>

      <header className="hero">
        <div className="hero-art" aria-hidden="true" />
        <div className="wrap hero-inner">
          <p className="eyebrow">DoorLoop CX · KPIs &amp; Comp</p>
          <h1>CSM Bonus Tracking</h1>
          <p className="lede">
            How each CSM is tracking against the bonus KPIs: logo churn, monthly → annual conversions, QBR
            coverage, NPS, save rate and CSAT. Pick a period to see the numbers for that window.
          </p>

          <nav className="pills" aria-label="Reporting period">
            {presets().map(({ label, window }) => {
              const active = activePreset?.label === label;
              return (
                <a
                  key={label}
                  className={`pill${active ? " pill-active" : ""}`}
                  href={presetHref(window)}
                  aria-current={active ? "true" : undefined}
                >
                  {label}
                </a>
              );
            })}
          </nav>

          <details className="range" open={customRange}>
            <summary>Pick specific dates</summary>
            <form className="range-form" method="get">
              <label>
                From
                <input type="date" name="from" defaultValue={windowStart} max={through} required />
              </label>
              <label>
                To
                <input type="date" name="through" defaultValue={through} min={windowStart} required />
              </label>
              <button type="submit" className="btn btn-neon">
                Apply
              </button>
            </form>
          </details>

          <p className="hero-meta">
            Source: <strong>{live ? "Salesforce (read-only)" : "Mock data"}</strong>
            {!live && " (Salesforce credentials not set, see .env.example)"}
          </p>
          <p className="hero-meta">
            Updated: <strong>{new Date(metrics.generatedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</strong>
          </p>
        </div>
      </header>

      <main>
        <section className="band">
          <div className="wrap">
            <h2>
              {activePreset ? `${activePreset.label}: ` : ""}
              {fmt(windowStart)} – {fmt(through)}
            </h2>
            <p className="band-sub">Team totals for the period, then each CSM against their target.</p>
            <div className="kpi-grid">
              {teamSummary(metrics).map((s) => (
                <SummaryCard key={s.label} s={s} />
              ))}
            </div>

            <div className="panels">
              <Panel
                title="Logo churn"
                info="Accounts whose Stripe subscription was canceled in the period, credited to the account's current CSM. Lower is better."
                section={metrics.logoChurn}
              />
              <Panel
                title="Net monthly → annual conversions"
                info="Monthly → annual switches minus annual → monthly downgrades (MRR changes) in the period."
                section={metrics.netConversions}
              />
              <Panel
                title="QBR coverage"
                info="Share of the CSM's active book (Account Status = Active Customer, today's assignment) with at least one completed CX Event of category Account Review in the period."
                section={metrics.qbrCoverage}
                unit="%"
                emptyNote="No active accounts are attributed to a CSM. QBRs count when logged as CX Events with category “Account Review”."
              />
            </div>
          </div>
        </section>

        <section className="band band-tint">
          <div className="wrap">
            <h2>Customer feedback &amp; saves</h2>
            <p className="band-sub">Survey results and cancellation saves for the same period.</p>
            <div className="panels">
              <Panel
                title="NPS"
                info="% promoters (9–10) minus % detractors (0–6), by survey send date. Coverage is partial until Intercom → Salesforce NPS (GTM-2512) ships."
                section={metrics.nps}
              />
              <Panel
                title="Save rate"
                info="Cancellation requests marked Saved over all assigned requests, grouped by who the request was assigned to."
                section={metrics.saveRate}
                unit="%"
              />
              <Panel
                title="CSAT"
                info="Average CX Event survey rating (1–5) for survey CX-CSAT, by submission date."
                section={metrics.csat}
                decimals={1}
                emptyNote="No CSAT responses (survey CX-CSAT) in this period."
              />
              <section className="panel">
                <h3>
                  Meaningful connections / Zoom minutes <Info text="Not wired up until GTM-2515 settles the definition." />
                </h3>
                <div className="note">
                  <strong>Not wired up yet.</strong> {metrics.meaningfulConnections.note}
                  <ul>
                    {metrics.meaningfulConnections.candidates.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </div>
              </section>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          Source: Salesforce, read-only. Metrics go to the account&apos;s Vitally Assigned CSM, falling back to the
          Temporary CSM. Targets are placeholders until the comp plan is final. Field mapping: GTM-2496 · Dashboard:
          GTM-2495.
        </div>
      </footer>
    </>
  );
}
