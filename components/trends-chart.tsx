"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendSeries {
  key: string;
  label: string;
}

const COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];

const shortDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });

/** Coins bondés par jour pour les metas les plus lancées (couleur fixe par meta, jamais par rang). */
export function TrendsChart({ data, series }: { data: Record<string, number | string>[]; series: TrendSeries[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis allowDecimals={false} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            cursor={{ stroke: "var(--muted)", strokeWidth: 1 }}
            contentStyle={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12, color: "var(--foreground)" }}
            labelFormatter={(d) => shortDay(String(d))}
            formatter={(v, name) => [`${v} bondés`, name]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconType="plainline"
            formatter={(value) => <span style={{ color: "var(--muted)" }}>{value}</span>}
          />
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={COLORS[i]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
