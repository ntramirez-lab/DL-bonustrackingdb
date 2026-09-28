import { NextResponse } from "next/server";
import { getBonusMetrics } from "@/lib/metrics";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const now = new Date();
  const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  const windowStart = searchParams.get("from") ?? quarterStart.toISOString().slice(0, 10);
  const windowEnd = searchParams.get("to") ?? now.toISOString().slice(0, 10);

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
