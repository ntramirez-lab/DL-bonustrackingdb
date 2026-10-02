// Reporting window shared by the page and /api/metrics. windowEnd is
// EXCLUSIVE (every query uses `< windowEnd`), so the default end is TOMORROW —
// ending at "today" silently drops today's rows, and on the first day of a
// quarter returns an empty window.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isDate = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

export interface ReportWindow {
  windowStart: string;
  windowEnd: string;
}

const tomorrowOf = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

// Clamps a [start, end) window so it never runs past today.
function capped(start: Date, end: Date, now: Date): ReportWindow {
  const tomorrow = tomorrowOf(now);
  return { windowStart: iso(start), windowEnd: iso(end < tomorrow ? end : tomorrow) };
}

export function quarterWindow(offset = 0, now = new Date()): ReportWindow {
  const q = Math.floor(now.getUTCMonth() / 3) + offset;
  return capped(
    new Date(Date.UTC(now.getUTCFullYear(), q * 3, 1)),
    new Date(Date.UTC(now.getUTCFullYear(), q * 3 + 3, 1)),
    now
  );
}

export function monthWindow(offset = 0, now = new Date()): ReportWindow {
  const m = now.getUTCMonth() + offset;
  return capped(
    new Date(Date.UTC(now.getUTCFullYear(), m, 1)),
    new Date(Date.UTC(now.getUTCFullYear(), m + 1, 1)),
    now
  );
}

export function yearToDateWindow(now = new Date()): ReportWindow {
  return capped(new Date(Date.UTC(now.getUTCFullYear(), 0, 1)), tomorrowOf(now), now);
}

// Precedence: ?from=YYYY-MM-DD with ?through=YYYY-MM-DD (INCLUSIVE, what the
// date picker sends) or ?to=YYYY-MM-DD (exclusive, kept for API callers);
// otherwise ?quarter=0 is quarter-to-date, -1 the previous quarter. Default is
// the LAST FULL quarter: quarter-to-date is nearly empty for the first weeks
// of every quarter.
// A range whose start isn't before its end falls back to the quarter.
export function resolveWindow(params: {
  from?: string | null;
  to?: string | null;
  through?: string | null;
  quarter?: string | null;
}): ReportWindow {
  const offset = Number.parseInt(params.quarter ?? "-1", 10);
  const base = quarterWindow(Number.isNaN(offset) ? -1 : offset);
  const windowStart = isDate(params.from) ? params.from : base.windowStart;
  const windowEnd = isDate(params.through)
    ? addDays(params.through, 1)
    : isDate(params.to)
      ? params.to
      : base.windowEnd;
  return windowStart < windowEnd ? { windowStart, windowEnd } : base;
}
