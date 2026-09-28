// SOQL for each GTM-2496-mapped metric, plus mock fallbacks so the dashboard
// runs before the read-only integration user exists. Field names below are
// confirmed against the salesforce repo's metadata (force-app/main/default/objects)
// as of GTM-2496 — re-verify against that repo if these objects change.
import { soqlQuery, usingMockData } from "./salesforce";

export interface CsmMetric {
  csm: string;
  value: number;
  target?: number;
  status: "good" | "warning" | "serious" | "critical";
}

export interface BonusMetrics {
  logoChurn: CsmMetric[];
  netConversions: CsmMetric[];
  qbrCoverage: CsmMetric[];
  nps: CsmMetric[];
  meaningfulConnections: { note: string; candidates: string[] };
  saveRate: CsmMetric[];
  csat: CsmMetric[];
  generatedAt: string;
  source: "salesforce" | "mock";
}

function statusFor(value: number, target: number): CsmMetric["status"] {
  const pct = target === 0 ? 1 : value / target;
  if (pct >= 1) return "good";
  if (pct >= 0.85) return "warning";
  if (pct >= 0.6) return "serious";
  return "critical";
}

// For metrics where LOWER is better (e.g. logo churn count vs. a cap) —
// meeting or beating the cap is "good"; status only degrades once value
// exceeds target.
function statusForLowerIsBetter(value: number, target: number): CsmMetric["status"] {
  if (value <= target) return "good";
  const pct = target / value;
  if (pct >= 0.85) return "warning";
  if (pct >= 0.6) return "serious";
  return "critical";
}

// --- Confirmed queries (GTM-2496) ---------------------------------------

// SOQL rejects a bare date literal against a DateTime field, so DateTime
// filters (CreatedDate, *_At__c) need a full UTC timestamp. Date fields
// (NPS_Score__c.Date__c, Requested_On__c) take the YYYY-MM-DD form as-is.
const dt = (date: string) => `${date}T00:00:00Z`;

// CSM attribution rule (confirmed with Natalia, 2026-09-28): a metric goes to
// the account's CURRENT Vitally_Assigned_CSM__c; if that's empty it falls back
// to Vitally_Temporary_CSM__c. Churn counts for the current CSM too — no
// crediting Previous_CSM__c. SOQL can't COALESCE inside GROUP BY, so each
// query groups by both lookups and attributedCsm() picks the owner per row.
const CSM_GROUP = (path: string) =>
  [
    `${path}Vitally_Assigned_CSM__c`,
    `${path}Vitally_Assigned_CSM__r.Name`,
    `${path}Vitally_Temporary_CSM__c`,
    `${path}Vitally_Temporary_CSM__r.Name`,
  ].join(", ");
const CSM_SELECT = (path: string) => `
  ${path}Vitally_Assigned_CSM__c csmId, ${path}Vitally_Assigned_CSM__r.Name csmName,
  ${path}Vitally_Temporary_CSM__c tmpId, ${path}Vitally_Temporary_CSM__r.Name tmpName`;

interface CsmAttributedRow {
  csmId?: string | null;
  csmName?: string | null;
  tmpId?: string | null;
  tmpName?: string | null;
}

export function attributedCsm(row: CsmAttributedRow): { id: string; name: string } {
  if (row.csmId) return { id: row.csmId, name: row.csmName ?? row.csmId };
  if (row.tmpId) return { id: row.tmpId, name: row.tmpName ?? row.tmpId };
  return { id: "unassigned", name: "Unassigned" };
}

// Collapses grouped-aggregate rows onto their attributed CSM, summing the
// given numeric fields. Averages must be rebuilt from summed totals/counts
// afterwards (never average the per-group averages).
export function rollupByCsm<K extends string>(
  rows: (CsmAttributedRow & Record<K, number | null>)[],
  fields: K[]
): Map<string, { name: string } & Record<K, number>> {
  const out = new Map<string, { name: string } & Record<K, number>>();
  for (const row of rows) {
    const { id, name } = attributedCsm(row);
    const acc = out.get(id) ?? ({ name, ...Object.fromEntries(fields.map((f) => [f, 0])) } as { name: string } & Record<K, number>);
    for (const f of fields) (acc as Record<K, number>)[f] += row[f] ?? 0;
    out.set(id, acc);
  }
  return out;
}

// 1. Logo churn per CSM — accounts whose Stripe subscription was canceled in
// the window, grouped by the CSM who owned them. "Locked as of Oct 1" =
// Stripe_Subscription_Canceled_At__c populated (per Alfredo/Santi, 2026-09-28).
const LOGO_CHURN_SOQL = (windowStart: string, windowEnd: string) => `
  SELECT ${CSM_SELECT("")}, COUNT(Id) churned
  FROM Account
  WHERE Stripe_Subscription_Canceled_At__c >= ${dt(windowStart)}
    AND Stripe_Subscription_Canceled_At__c < ${dt(windowEnd)}
    AND Test_Account__c = false
  GROUP BY ${CSM_GROUP("")}
`;

// 2. Net monthly<->annual conversions — MRR_Change__c rows where the billing
// interval flipped between month and year.
const NET_CONVERSIONS_SOQL = (windowStart: string, windowEnd: string) => `
  SELECT ${CSM_SELECT("Account__r.")},
         Starting_Price_Interval__c, Ending_Price_Interval__c,
         COUNT(Id) changes
  FROM MRR_Change__c
  WHERE CreatedDate >= ${dt(windowStart)} AND CreatedDate < ${dt(windowEnd)}
    AND ((Starting_Price_Interval__c = 'month' AND Ending_Price_Interval__c = 'year')
      OR (Starting_Price_Interval__c = 'year' AND Ending_Price_Interval__c = 'month'))
  GROUP BY ${CSM_GROUP("Account__r.")}, Starting_Price_Interval__c, Ending_Price_Interval__c
`;

// 3. QBR coverage — CX_Event__c records categorized "Account Review"
// ("Business Review with DoorLoop", confirmed 2026-09-28), completed in
// the period, vs. the CSM's active book size.
const QBR_COVERAGE_SOQL = (windowStart: string, windowEnd: string) => `
  SELECT ${CSM_SELECT("Account__r.")}, COUNT(Id) qbrs_completed
  FROM CX_Event__c
  WHERE Event_Category__c = 'Account Review'
    AND Completed_At__c >= ${dt(windowStart)} AND Completed_At__c < ${dt(windowEnd)}
  GROUP BY ${CSM_GROUP("Account__r.")}
`;

// 4. NPS — NPS_Score__c is a child of Contact (Master-Detail Contact__c), so
// join Contact -> Account to reach the CSM. NPS_Score__c.User__c is the
// follow-up caller ("Who called?"), not the CSM — never group by it.
// NPS is %promoters (9-10) minus %detractors (0-6), not an average of
// Score__c, so group by the raw score (0-10) and bucket with npsFromScores().
// Date__c is the date the survey was SENT. Onboarding NPS lives separately on
// Onboarding__c.Onboarding_NPS_Score__c and is not included here.
// Note: population is still partly manual pending GTM-2512 (Intercom -> SF
// automation); treat coverage as incomplete until that ships.
const NPS_SOQL = (windowStart: string, windowEnd: string) => `
  SELECT ${CSM_SELECT("Contact__r.Account.")},
         Score__c score, COUNT(Id) responses
  FROM NPS_Score__c
  WHERE Date__c >= ${windowStart} AND Date__c < ${windowEnd}
    AND Score__c != null
  GROUP BY ${CSM_GROUP("Contact__r.Account.")}, Score__c
`;

export function npsFromScores(rows: { score: number; responses: number }[]): number | null {
  let promoters = 0, detractors = 0, total = 0;
  for (const { score, responses } of rows) {
    total += responses;
    if (score >= 9) promoters += responses;
    else if (score <= 6) detractors += responses;
  }
  return total === 0 ? null : Math.round(((promoters - detractors) / total) * 100);
}

// 5. Save rate — DoorLoop_Cancelation_Request__c: Status__c = 'Saved' over
// all assigned requests in the period. Grouped by the request's Assigned_To__c
// (whoever worked the cancellation), not the account CSM rule above.
const SAVE_RATE_SOQL = (windowStart: string, windowEnd: string) => `
  SELECT Assigned_To__r.Name agent, Status__c, COUNT(Id) requests
  FROM DoorLoop_Cancelation_Request__c
  WHERE Requested_On__c >= ${windowStart} AND Requested_On__c < ${windowEnd}
    AND Assigned_To__c != null
  GROUP BY Assigned_To__r.Name, Status__c
`;

// 6. CSAT — CX_Event__c.Survey_Rating__c (1-5 scale), MUST filter by
// Survey_Id__c so the average never mixes rating scales from other survey
// types stamped on the same field. Exported (not yet called from
// getBonusMetrics below) because the CSAT survey's Survey_Id__c value isn't
// pinned down yet — wire this in once that's confirmed.
export const CSAT_SOQL = (surveyId: string, windowStart: string, windowEnd: string) => `
  SELECT ${CSM_SELECT("Account__r.")}, SUM(Survey_Rating__c) rating_total, COUNT(Survey_Rating__c) responses
  FROM CX_Event__c
  WHERE Survey_Id__c = '${surveyId}'
    AND Survey_Submitted_At__c >= ${dt(windowStart)} AND Survey_Submitted_At__c < ${dt(windowEnd)}
  GROUP BY ${CSM_GROUP("Account__r.")}
`;

// --- Unresolved (GTM-2515) ------------------------------------------------
// Meaningful connections / Zoom minutes has no confirmed source yet.
// Two candidates, neither confirmed as of 2026-09-28:
//   - CX_Event__c.Meeting_Actual_Duration__c (actual Zoom video-meeting
//     duration per logged customer event)
//   - ZVC__Zoom_Call_Log__c.Call_Duration_Minutes__c (Zoom PHONE call logs,
//     tied to Tasks via ZoomTaskAssociationBatch — likely the wrong object,
//     since "meaningful connections" is about video meetings)
// Do not wire either into production metrics until GTM-2515 closes.

export const MEANINGFUL_CONNECTIONS_GAP = {
  note: "Metric definition and Salesforce source unresolved — see GTM-2515.",
  candidates: [
    "CX_Event__c.Meeting_Actual_Duration__c",
    "ZVC__Zoom_Call_Log__c.Call_Duration_Minutes__c (Zoom Phone — likely wrong object)",
  ],
};

// --- Mock data (default until the read-only integration user exists) ----

function mockMetrics(): BonusMetrics {
  const csms = ["A. Ramirez", "J. Ortiz", "S. Huang", "M. Castillo"];
  const mk = (target: number, spread: number): CsmMetric[] =>
    csms.map((csm, i) => {
      const value = Math.round(target * (0.7 + spread * i));
      return { csm, value, target, status: statusFor(value, target) };
    });

  return {
    logoChurn: mk(2, 0.15).map((m) => ({ ...m, status: statusForLowerIsBetter(m.value, m.target!) })),
    netConversions: mk(10, 0.12),
    qbrCoverage: mk(8, 0.1),
    nps: mk(50, 0.05),
    meaningfulConnections: MEANINGFUL_CONNECTIONS_GAP,
    saveRate: mk(60, 0.08),
    csat: mk(4.5, 0.03),
    generatedAt: new Date().toISOString(),
    source: "mock",
  };
}

export async function getBonusMetrics(windowStart: string, windowEnd: string): Promise<BonusMetrics> {
  if (usingMockData()) return mockMetrics();

  // Real fetch — left intentionally simple (parallel raw queries, light
  // shaping) until the actual dashboard requirements (targets per CSM,
  // pooled vs. dedicated split) are finalized with Samuel.
  const [churn, conversions, qbr, nps, saves] = await Promise.all([
    soqlQuery(LOGO_CHURN_SOQL(windowStart, windowEnd)),
    soqlQuery(NET_CONVERSIONS_SOQL(windowStart, windowEnd)),
    soqlQuery(QBR_COVERAGE_SOQL(windowStart, windowEnd)),
    soqlQuery(NPS_SOQL(windowStart, windowEnd)),
    soqlQuery(SAVE_RATE_SOQL(windowStart, windowEnd)),
  ]);

  // TODO: shape these into CsmMetric[] via rollupByCsm() once per-CSM
  // targets are defined (comp plan values aren't in Salesforce).
  void churn;
  void conversions;
  void qbr;
  void nps;
  void saves;

  return { ...mockMetrics(), source: "salesforce" };
}
