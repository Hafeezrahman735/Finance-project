import React from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money, shortDate } from "../../lib/format";

/**
 * 30-day money in / money out bars. Two colors only (positive, muted), no
 * gridlines, no legend chrome; a visually hidden table carries the same data
 * for screen readers (plan: Pass 6).
 */
export default function InOutChart({ daily, currency = "USD" }) {
  const data = daily.map((d) => ({ ...d, label: shortDate(d.date), inMajor: d.inMinor / 100, outMajor: d.outMinor / 100 }));
  const hasAny = daily.some((d) => d.inMinor > 0 || d.outMinor > 0);
  if (!hasAny) return <p className="text-muted">No activity in the last 30 days.</p>;
  return (
    <div>
      <div className="h-48 w-full" aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={data} barGap={1} barCategoryGap="20%" margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={6} tick={{ fill: "#625f57", fontSize: 12 }} />
            <YAxis hide />
            <Tooltip
              cursor={{ fill: "#e0f2f0" }}
              contentStyle={{ border: "1px solid #e5e2db", borderRadius: 6, boxShadow: "none", fontSize: 14 }}
              formatter={(value, name) => [money(Math.round(value * 100), currency), name === "inMajor" ? "Money in" : "Money out"]}
              labelFormatter={(l) => l}
            />
            <Bar dataKey="inMajor" fill="#1a7f4b" radius={[2, 2, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="outMajor" fill="#9c988e" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Money in and money out per day, last 30 days</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Money in</th>
            <th scope="col">Money out</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date}>
              <td>{d.date}</td>
              <td>{money(d.inMinor, currency)}</td>
              <td>{money(d.outMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
