import { NextResponse } from "next/server";
import { getBonusMetrics } from "@/lib/metrics";
import { resolveWindow } from "@/lib/window";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const { windowStart, windowEnd } = resolveWindow({
    from: searchParams.get("from"),
    to: searchParams.get("to"),
    quarter: searchParams.get("quarter"),
  });

  try {
    const metrics = await getBonusMetrics(windowStart, windowEnd);
    return NextResponse.json(metrics);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
