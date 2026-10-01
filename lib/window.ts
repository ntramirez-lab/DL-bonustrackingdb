// Reporting window shared by the page and /api/metrics. windowEnd is
// EXCLUSIVE (every query uses `< windowEnd`), so the default end is TOMORROW —
// ending at "today" silently drops today's rows, and on the first day of a
// quarter returns an empty window.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface ReportWindow {
  windowStart: string;
  windowEnd: string;
}

export function quarterWindow(offset = 0, now = new Date()): ReportWindow {
  const q = Math.floor(now.getUTCMonth() / 3) + offset;
  const start = new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1));
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return { windowStart: iso(start), windowEnd: iso(end < tomorrow ? end : tomorrow) };
}

// ?from=YYYY-MM-DD&to=YYYY-MM-DD (to exclusive) wins; ?quarter=-1 picks the
// previous quarter; default is quarter-to-date.
export function resolveWindow(params: { from?: string | null; to?: string | null; quarter?: string | null }): ReportWindow {
  const base = quarterWindow(Number.parseInt(params.quarter ?? "0", 10) || 0);
  return {
    windowStart: isDate(params.from) ? params.from : base.windowStart,
    windowEnd: isDate(params.to) ? params.to : base.windowEnd,
  };
}
