import React, { useState } from "react";
import { fetchApiTimeSeries, type TimeSeriesPoint } from "../api/apis.js";
import { useAsync } from "../hooks/useAsync.js";

type Days = 7 | 30 | 90;

const CHART_W = 600;
const CHART_H = 120;
const PAD_LEFT = 40;
const PAD_RIGHT = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 24;

const PLOT_W = CHART_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = CHART_H - PAD_TOP - PAD_BOTTOM;

/** Compute nice Y-axis ticks given a max value. */
function niceTicks(maxVal: number, count = 4): number[] {
  if (maxVal === 0) return [0, 1, 2, 3].map((i) => i);
  const raw = maxVal / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.ceil(raw / mag) * mag;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

interface BarChartProps {
  points: TimeSeriesPoint[];
  getValue: (p: TimeSeriesPoint) => number;
  label: string;
  unit: string;
  color: string; // tailwind-compatible CSS color value
  days: Days;
}

function BarChart({ points, getValue, label, unit, color, days }: BarChartProps) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const values = points.map(getValue);
  const maxVal = Math.max(...values, 0);
  const ticks = niceTicks(maxVal);
  const tickMax = ticks[ticks.length - 1];

  const barW = Math.max(2, PLOT_W / points.length - 2);

  /** Format date label — show fewer labels when there are many bars. */
  function dateLabel(dateStr: string, i: number): string | null {
    // For 90 days show every ~15th; for 30 days every ~7th; for 7 days every day.
    const step = days === 90 ? 15 : days === 30 ? 7 : 1;
    if (i % step !== 0 && i !== points.length - 1) return null;
    const d = new Date(dateStr + "T00:00:00Z");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  }

  return (
    <div className="relative">
      <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
        {label} <span className="text-gray-400 dark:text-gray-500">({unit})</span>
      </p>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full"
        aria-label={`${label} bar chart`}
        role="img"
        onMouseLeave={() => setTooltip(null)}
      >
        {/* Y-axis ticks and grid lines */}
        {ticks.map((tick) => {
          const y = PAD_TOP + PLOT_H - (tick / tickMax) * PLOT_H;
          return (
            <g key={tick}>
              <line
                x1={PAD_LEFT}
                x2={CHART_W - PAD_RIGHT}
                y1={y}
                y2={y}
                className="stroke-gray-100 dark:stroke-gray-700"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 4}
                y={y + 4}
                textAnchor="end"
                className="fill-gray-400 dark:fill-gray-500"
                style={{ fontSize: 9 }}
              >
                {tick >= 1000 ? `${(tick / 1000).toFixed(1)}k` : tick}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {points.map((p, i) => {
          const val = getValue(p);
          const barH = tickMax === 0 ? 0 : Math.max(0, (val / tickMax) * PLOT_H);
          const x = PAD_LEFT + (i / points.length) * PLOT_W + (PLOT_W / points.length - barW) / 2;
          const y = PAD_TOP + PLOT_H - barH;
          const labelText = dateLabel(p.date, i);

          return (
            <g key={p.date}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(barH, 0)}
                fill={color}
                rx={2}
                opacity={0.85}
                onMouseEnter={(e) => {
                  const svg = (e.currentTarget as SVGElement).closest("svg")!;
                  const rect = svg.getBoundingClientRect();
                  setTooltip({
                    x: ((x + barW / 2) / CHART_W) * 100,
                    y: PAD_TOP + PLOT_H - barH,
                    text: `${p.date}: ${val} ${unit}`,
                  });
                }}
              />
              {labelText && (
                <text
                  x={x + barW / 2}
                  y={CHART_H - 4}
                  textAnchor="middle"
                  className="fill-gray-400 dark:fill-gray-500"
                  style={{ fontSize: 8 }}
                >
                  {labelText}
                </text>
              )}
            </g>
          );
        })}

        {/* Y-axis line */}
        <line
          x1={PAD_LEFT}
          x2={PAD_LEFT}
          y1={PAD_TOP}
          y2={PAD_TOP + PLOT_H}
          className="stroke-gray-200 dark:stroke-gray-600"
          strokeWidth={1}
        />
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded bg-gray-900 px-2 py-1 text-xs text-white dark:bg-gray-100 dark:text-gray-900"
          style={{ left: `${tooltip.x}%`, top: `${(tooltip.y / CHART_H) * 100 + 5}%` }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

interface StatsChartsProps {
  apiId: string;
  apiKey: string;
}

export function StatsCharts({ apiId, apiKey }: StatsChartsProps) {
  const [days, setDays] = useState<Days>(30);

  const { status, data, error } = useAsync(
    (_signal) => fetchApiTimeSeries(apiKey, apiId, days),
    [apiId, apiKey, days],
  );

  const periods: Days[] = [7, 30, 90];

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200">Trends</h4>
        <div
          className="flex rounded-lg border border-gray-200 dark:border-gray-600"
          role="group"
          aria-label="Time period"
        >
          {periods.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={`px-3 py-1 text-xs font-medium first:rounded-l-lg last:rounded-r-lg focus:z-10 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                days === d
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {status === "loading" && (
        <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
      )}

      {status === "error" && (
        <p className="py-4 text-center text-sm text-red-600 dark:text-red-400">
          {error ?? "Could not load chart data"}
        </p>
      )}

      {status === "success" && data && (
        <div className="grid gap-6 sm:grid-cols-2">
          <BarChart
            points={data.series}
            getValue={(p) => p.calls}
            label="Calls"
            unit="calls"
            color="#6366f1"
            days={days}
          />
          <BarChart
            points={data.series}
            getValue={(p) => parseFloat(p.revenue)}
            label="Revenue"
            unit="USDC"
            color="#10b981"
            days={days}
          />
        </div>
      )}
    </div>
  );
}
