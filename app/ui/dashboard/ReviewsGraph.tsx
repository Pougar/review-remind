"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Area,
  Line,
  Tooltip,
} from "recharts";
import { API } from "@/app/lib/constants";

type ApiPoint = [dateISO: string, good: number, bad: number];

type Props = {
  userId: string | null;
  /** Optional: scope to a specific business (recommended in the new app). */
  businessSlug?: string;
  months?: number; // default 12
  /** Optional: refresh key to trigger data refetch */
  refreshKey?: number;
};

type Monthly = {
  label: string;   // "Jan 2025"
  total: number;
  x: number;       // numeric index for axis domain control
};

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return "Unknown error";
  }
}

export default function ReviewsGraph({ userId, businessSlug, months = 12, refreshKey }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [raw, setRaw] = useState<ApiPoint[]>([]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;

    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(API.GET_GRAPH_INFO, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // businessSlug is optional; include it if available
          body: JSON.stringify({ userId, businessSlug }),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Graph info error ${res.status}`);
        const data = (await res.json()) as { points?: ApiPoint[] };
        if (!alive) return;
        const points: ApiPoint[] = Array.isArray(data?.points) ? data.points! : [];
        setRaw(points);
      } catch (e: unknown) {
        if (alive) setErr(getErrorMessage(e) || "Failed to load review trends.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [userId, businessSlug, refreshKey]);

  const data: Monthly[] = useMemo(() => {
    const now = new Date();
    const bins: Record<string, { label: string; good: number; bad: number }> = {};
    const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const monthLabel = (d: Date) =>
      d.toLocaleString(undefined, { month: "short", year: "numeric" });

    // Seed month bins
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      d.setUTCMonth(d.getUTCMonth() - i);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      bins[key] = { label: monthLabel(d), good: 0, bad: 0 };
    }

    // Aggregate daily → monthly (UTC)
    for (const [iso, good, bad] of raw) {
      const d = new Date(`${iso}T00:00:00Z`);
      const key = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      if (!bins[key]) continue;
      bins[key].good += Number.isFinite(good) ? good : 0;
      bins[key].bad += Number.isFinite(bad) ? bad : 0;
    }

    // Build ordered array and attach numeric x index
    return Object.values(bins).map((v, idx) => ({
      label: v.label,
      total: v.good + v.bad,
      x: idx,
    }));
  }, [raw, months]);

  if (!userId)
    return <div className="text-sm text-gray-600">Sign in to see your monthly review trends.</div>;
  if (loading) return <div className="h-72 w-full rounded-xl border border-gray-200 bg-gray-50" />;
  if (err) return <div className="text-sm text-amber-800">{err}</div>;
  if (data.length === 0 || data.every((d) => d.total === 0))
    return <div className="text-sm text-gray-600">No reviews yet for the selected period.</div>;

  // --- Styling tokens (slate tones, subtle grid) ---
  const AXIS = "#64748b"; // slate-500
  const GRID = "#e2e8f0"; // slate-200
  const LINE = "#0f172a"; // slate-900
  const AREA_TOP = "rgba(15, 23, 42, 0.14)"; // subtle
  const AREA_BOTTOM = "rgba(15, 23, 42, 0.04)";

  // Y: extend above peak for headroom (≥25% or round up to multiple of 4)
  const maxTotal = Math.max(...data.map((d) => d.total));
  const yTarget = Math.ceil(maxTotal * 1.25);
  const yMax = Math.max(maxTotal + 1, Math.ceil(yTarget / 4) * 4);

  // X: numeric domain with a little extra room to the right for "growth"
  const endIndex = data.length - 1;
  const xDomain: [number, number] = [0, endIndex + 0.4];

  // Only start/end ticks
  const startLabel = data[0]?.label ?? "";
  const endLabel = data[endIndex]?.label ?? "";
  const ticks = data.length > 1 ? [0, endIndex] : [0];
  const tickFormatter = (x: number) =>
    x === 0 ? startLabel : x === endIndex ? endLabel : "";

  return (
    <div className="w-full">
      <div className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            {/* Subtle grid */}
            <CartesianGrid stroke={GRID} vertical={false} />

            {/* Numeric X axis so we can extend domain */}
            <XAxis
              type="number"
              dataKey="x"
              domain={xDomain}
              ticks={ticks}
              tickFormatter={tickFormatter}
              tick={{ fill: AXIS, fontSize: 12 }}
              tickMargin={8}
              axisLine={{ stroke: GRID }}
              tickLine={false}
            />

            <YAxis
              allowDecimals={false}
              domain={[0, yMax]}
              tick={{ fill: AXIS, fontSize: 12 }}
              axisLine={false}
              tickLine={false}
              tickMargin={12}
            />

            {/* Clean, minimal look: no tooltips/legend/active dots */}
            <defs>
              <linearGradient id="totalArea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={AREA_TOP} />
                <stop offset="100%" stopColor={AREA_BOTTOM} />
              </linearGradient>
            </defs>

            {/* Tooltip for hover display */}
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null;
                const data = payload[0].payload as Monthly;
                return (
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
                    <p className="text-sm font-semibold text-gray-900">{data.label}</p>
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{data.total}</span> review{data.total === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              }}
            />

            {/* Soft area under the line */}
            <Area
              type="stepAfter"
              dataKey="total"
              stroke="none"
              fill="url(#totalArea)"
              isAnimationActive
            />

            {/* Slate line for total with straight edges */}
            <Line
              dataKey="total"
              type="stepAfter"
              stroke={LINE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: LINE }}
              isAnimationActive
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
