import { getBonusMetrics, type Attribution, type BonusMetrics, type CsmMetric, type MetricSection } from "@/lib/metrics";
import { notCountedReason, teamOf, TEAMS, type Team } from "@/lib/teams";
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

const VIEWS: { id: Attribution; label: string; note: string }[] = [
  {
    id: "assigned",
    label: "Assigned CSM",
    note: "Each account counts for its Vitally Assigned CSM, the permanent owner.",
  },
  {
    id: "temporary",
    label: "Temporary CSM (interim)",
    note: "Each account counts for its Vitally Temporary CSM: today the dedicated team's interim books, later the pooled CSM working the account.",
  },
];

const href = (from: string, through: string, by: Attribution) => `?from=${from}&through=${through}&by=${by}`;

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

// --- Team split ---------------------------------------------------------------

const forTeam = (s: MetricSection, team: Team): MetricSection => ({
  error: s.error,
  rows: s.rows.filter((r) => teamOf(r.csm) === team),
});

// Every name with data that isn't on a team roster, with what's attributed to
// them, so the team can clean up assignments in Salesforce.
function notCounted(m: BonusMetrics) {
  const out = new Map<string, { reason: string; accounts: number; churned: number; cancellations: number }>();
  const touch = (name: string) => {
    const row = out.get(name) ?? { reason: notCountedReason(name), accounts: 0, churned: 0, cancellations: 0 };
    out.set(name, row);
    return row;
  };
  for (const r of m.qbrCoverage.rows) if (!teamOf(r.csm)) touch(r.csm).accounts += r.parts?.den ?? 0;
  for (const r of m.logoChurn.rows) if (!teamOf(r.csm)) touch(r.csm).churned += r.value;
  for (const r of m.saveRate.rows) if (!teamOf(r.csm)) touch(r.csm).cancellations += r.parts?.den ?? 0;
  for (const s of [m.netConversions, m.nps, m.csat]) for (const r of s.rows) if (!teamOf(r.csm)) touch(r.csm);
  return [...out].sort(([a], [b]) =>
    a === "Unassigned" ? -1 : b === "Unassigned" ? 1 : a.localeCompare(b)
  );
}

// --- Team summary (big coloured cards) ------------------------------------------

interface Summary {
  label: string;
  value: string;
  sub: string;
  tone: "navy" | "blue" | "neon" | "ink";
}

const unavailable = (s: MetricSection) => !!s.error || s.rows.length === 0;
const sum = (s: MetricSection) => s.rows.reduce((acc, r) => acc + r.value, 0);

// Ratio metrics are pooled from their parts, never averaged across CSMs.
function pooled(s: MetricSection, noun: string): { value: string; sub: string } {
  const num = s.rows.reduce((acc, r) => acc + (r.parts?.num ?? 0), 0);
  const den = s.rows.reduce((acc, r) => acc + (r.parts?.den ?? 0), 0);
  if (den === 0) return { value: "—", sub: "no data in this period" };
  return { value: `${Math.round((num / den) * 100)}%`, sub: `${num.toLocaleString()} of ${den.toLocaleString()} ${noun}` };
}

function teamSummary(m: Record<"logoChurn" | "netConversions" | "qbrCoverage" | "saveRate", MetricSection>): Summary[] {
  const net = sum(m.netConversions);
  return [
    {
      label: "Logo churn",
      value: unavailable(m.logoChurn) ? "—" : sum(m.logoChurn).toLocaleString(),
      sub: "accounts canceled (lower is better)",
      tone: "navy",
    },
    {
      label: "Net monthly → annual",
      value: unavailable(m.netConversions) ? "—" : `${net > 0 ? "+" : ""}${net.toLocaleString()}`,
      sub: m.netConversions.error ? "couldn't load" : "upgrades minus downgrades",
      tone: "blue",
    },
    { label: "QBR coverage", ...pooled(m.qbrCoverage, "active accounts"), tone: "neon" },
    { label: "Save rate", ...pooled(m.saveRate, "requests saved"), tone: "ink" },
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
  emptyNote = "No records for this team in this period.",
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

function TeamBand({ label, m, tint }: { label: string; m: BonusMetrics; tint: boolean }) {
  return (
    <section className={`band${tint ? " band-tint" : ""}`}>
      <div className="wrap">
        <h2>{label}</h2>
        <p className="band-sub">Team totals for the period, then each CSM against their target.</p>
        <div className="kpi-grid">
          {teamSummary(m).map((s) => (
            <SummaryCard key={s.label} s={s} />
          ))}
        </div>
        <div className="panels">
          <Panel
            title="Logo churn"
            info="Accounts whose Stripe subscription was canceled in the period, credited to the account's current CSM in this view. Lower is better."
            section={m.logoChurn}
          />
          <Panel
            title="Net monthly → annual conversions"
            info="Monthly → annual switches minus annual → monthly downgrades, from MRR Change records in the period."
            section={m.netConversions}
          />
          <Panel
            title="QBR coverage"
            info="Share of the CSM's active book (Account Status = Active Customer) with at least one completed CX Event of category Account Review in the period."
            section={m.qbrCoverage}
            unit="%"
            emptyNote="No active accounts for this team in this view. QBRs count when logged as CX Events with category “Account Review”."
          />
          <Panel
            title="NPS"
            info="% promoters (9–10) minus % detractors (0–6), by survey send date. Coverage is partial until Intercom → Salesforce NPS (GTM-2512) ships."
            section={m.nps}
          />
          <Panel
            title="Save rate"
            info="Cancellation requests marked Saved over all requests assigned to the CSM in the period (by who worked the request, same in both views)."
            section={m.saveRate}
            unit="%"
          />
          <Panel
            title="CSAT"
            info="Average CX Event survey rating (1–5) for survey CX-CSAT, by submission date."
            section={m.csat}
            decimals={1}
            emptyNote="No CSAT responses (survey CX-CSAT) for this team in this period."
          />
        </div>
      </div>
    </section>
  );
}

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const by: Attribution = one(params.by) === "temporary" ? "temporary" : "assigned";
  const { windowStart, windowEnd } = resolveWindow({
    from: one(params.from),
    to: one(params.to),
    through: one(params.through),
    quarter: one(params.quarter),
  });
  const through = addDays(windowEnd, -1);
  const metrics = await getBonusMetrics(windowStart, windowEnd, by);
  const live = metrics.source === "salesforce";
  const activePreset = presets().find(
    ({ window }) => window.windowStart === windowStart && window.windowEnd === windowEnd
  );
  const view = VIEWS.find((v) => v.id === by)!;
  const leftover = notCounted(metrics);

  const team = (t: Team): BonusMetrics => ({
    ...metrics,
    logoChurn: forTeam(metrics.logoChurn, t),
    netConversions: forTeam(metrics.netConversions, t),
    qbrCoverage: forTeam(metrics.qbrCoverage, t),
    nps: forTeam(metrics.nps, t),
    saveRate: forTeam(metrics.saveRate, t),
    csat: forTeam(metrics.csat, t),
  });

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
            How the dedicated and pooled teams are tracking against the bonus KPIs: logo churn, monthly → annual
            conversions, QBR coverage, NPS, save rate and CSAT. Pick a period and which CSM field to count by.
          </p>

          <nav className="pills" aria-label="Reporting period">
            {presets().map(({ label, window }) => {
              const active = activePreset?.label === label;
              return (
                <a
                  key={label}
                  className={`pill${active ? " pill-active" : ""}`}
                  href={href(window.windowStart, addDays(window.windowEnd, -1), by)}
                  aria-current={active ? "true" : undefined}
                >
                  {label}
                </a>
              );
            })}
          </nav>

          <details className="range" open={!activePreset}>
            <summary>Pick specific dates</summary>
            <form className="range-form" method="get">
              <input type="hidden" name="by" value={by} />
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

          <div className="view-switch">
            <span className="view-label">Count accounts by</span>
            <nav className="pills" aria-label="CSM field">
              {VIEWS.map((v) => (
                <a
                  key={v.id}
                  className={`pill${v.id === by ? " pill-active" : ""}`}
                  href={href(windowStart, through, v.id)}
                  aria-current={v.id === by ? "true" : undefined}
                >
                  {v.label}
                </a>
              ))}
            </nav>
          </div>

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
        <div className="period-head">
          <div className="wrap">
            <h2>
              {activePreset ? `${activePreset.label}: ` : ""}
              {fmt(windowStart)} – {fmt(through)}
            </h2>
            <p className="band-sub">
              <strong>{view.label}.</strong> {view.note}
            </p>
          </div>
        </div>

        {TEAMS.map((t, i) => (
          <TeamBand key={t.id} label={t.label} m={team(t.id)} tint={i % 2 === 1} />
        ))}

        <section className="band">
          <div className="wrap">
            <h2>Not counted</h2>
            <p className="band-sub">
              Accounts and records attributed to someone outside the dedicated and pooled rosters. They don&apos;t
              count toward either team. Anyone here besides “Unassigned” is an assignment to clean up in
              Salesforce.
            </p>
            <section className="panel">
              {leftover.length === 0 ? (
                <div className="note">Everything in this period is attributed to a team member.</div>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Why it&apos;s not counted</th>
                        <th className="num">Active accounts</th>
                        <th className="num">Churned in period</th>
                        <th className="num">Cancellation requests</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leftover.map(([name, r]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td className="muted">{r.reason}</td>
                          <td className="num">{r.accounts.toLocaleString()}</td>
                          <td className="num">{r.churned.toLocaleString()}</td>
                          <td className="num">{r.cancellations.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </section>

        <section className="band band-tint">
          <div className="wrap">
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
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          Source: Salesforce, read-only. Team rosters live in lib/teams.ts (Salesforce has no dedicated/pooled
          field). Targets are placeholders until the comp plan is final. Field mapping: GTM-2496 · Dashboard:
          GTM-2495.
        </div>
      </footer>
    </>
  );
}
