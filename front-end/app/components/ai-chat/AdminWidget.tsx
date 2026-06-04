import type { AIResponse } from "@/app/lib/services/chat.service";

// ────────────────────────────────────────────────────────────────────
// AdminWidget — Phase C BI renderer.
//
// Renders layout="admin_widget" payloads in one of four chart styles
// based on payload.kind. Pure CSS / inline SVG — no chart library
// dependency, no runtime download.
//
//   kpi_grid    : compact key-value grid (existing behavior)
//   bar_chart   : horizontal bars from data.x[] + data.y[]
//   line_chart  : inline SVG polyline from data.x[] + data.y[]
//   pie_chart   : legend table from data.slices = [{label, value}]
//
// Falls back to kpi_grid for any unknown kind so the chat never crashes.
// ────────────────────────────────────────────────────────────────────
export default function AdminWidget({
  data,
}: {
  data: { kind: NonNullable<AIResponse["payload"]["kind"]>; title: string; data: Record<string, unknown> };
}) {
  const d = data.data || {};
  return (
    <div className="mt-2 border border-indigo-200 rounded-lg p-2 text-[11px] bg-indigo-50">
      {data.title && <div className="font-semibold text-indigo-700 mb-1">{data.title}</div>}
      {data.kind === "bar_chart"   && <BarChartView d={d} />}
      {data.kind === "line_chart"  && <LineChartView d={d} />}
      {data.kind === "pie_chart"   && <PieLegendView d={d} />}
      {(data.kind === "kpi_grid" || !["bar_chart","line_chart","pie_chart"].includes(data.kind)) && (
        <KpiGridView d={d} />
      )}
    </div>
  );
}

// Helpers — extract typed arrays from a loose data bag without throwing.
function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x) || 0) : [];
}
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x ?? "")) : [];
}

// Horizontal-bar chart, CSS-only.
function BarChartView({ d }: { d: Record<string, unknown> }) {
  const labels = asStringArray(d.x);
  const values = asNumberArray(d.y);
  const max = Math.max(1, ...values);
  if (labels.length === 0) {
    return (
      <div className="text-[11px] text-indigo-700 italic">
        {String(d.note || "Өгөгдөл алга.")}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {labels.map((label, i) => {
        const v = values[i] || 0;
        const pct = Math.max(2, Math.round((v / max) * 100));
        return (
          <div key={`${label}-${i}`} className="flex items-center gap-2">
            <div className="w-24 text-[10px] text-gray-700 truncate font-mono shrink-0" title={label}>{label}</div>
            <div className="flex-1 h-3 bg-white rounded overflow-hidden border border-indigo-100">
              <div className="h-full bg-gradient-to-r from-indigo-400 to-amber-500" style={{ width: `${pct}%` }} />
            </div>
            <div className="w-12 text-right text-[10px] font-mono text-indigo-700 shrink-0">{v.toLocaleString()}</div>
          </div>
        );
      })}
      {d.seasonalNote ? <div className="mt-1 text-[10px] text-indigo-600 italic">{String(d.seasonalNote)}</div> : null}
      {d.note ? <div className="mt-1 text-[10px] text-indigo-600 italic">{String(d.note)}</div> : null}
    </div>
  );
}

// Inline SVG polyline (trend lines).
function LineChartView({ d }: { d: Record<string, unknown> }) {
  const labels = asStringArray(d.x);
  const values = asNumberArray(d.y);
  if (values.length < 2) {
    return <div className="text-[11px] text-indigo-700 italic">Хангалттай цэг алга.</div>;
  }
  const W = 300, H = 80, P = 4;
  const max = Math.max(...values), min = Math.min(...values, 0);
  const span = Math.max(1, max - min);
  const xStep = (W - 2 * P) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = P + i * xStep;
      const y = P + (H - 2 * P) * (1 - (v - min) / span);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div>
      <svg width={W} height={H} className="w-full h-auto">
        <polyline fill="none" stroke="rgb(99, 102, 241)" strokeWidth="2" points={points} />
        {values.map((v, i) => (
          <circle key={i} cx={P + i * xStep} cy={P + (H - 2 * P) * (1 - (v - min) / span)} r="2.5" fill="rgb(217, 70, 239)" />
        ))}
      </svg>
      <div className="flex justify-between text-[9px] text-indigo-500 font-mono mt-0.5">
        {labels.map((l, i) => <span key={`${l}-${i}`}>{l}</span>)}
      </div>
    </div>
  );
}

// Pie chart → legend table (cheap, readable, accessible).
function PieLegendView({ d }: { d: Record<string, unknown> }) {
  const slices = (Array.isArray(d.slices) ? d.slices : []) as Array<{ label: string; value: number }>;
  if (slices.length === 0) {
    return <div className="text-[11px] text-indigo-700 italic">Хуваарилалт алга.</div>;
  }
  const total = slices.reduce((s, sl) => s + (Number(sl.value) || 0), 0) || 1;
  const palette = ["bg-indigo-500", "bg-amber-500", "bg-emerald-500", "bg-amber-500", "bg-rose-500", "bg-cyan-500", "bg-blue-500"];
  return (
    <div className="space-y-1">
      {slices.map((sl, i) => {
        const pct = Math.round(((Number(sl.value) || 0) / total) * 100);
        return (
          <div key={`${sl.label}-${i}`} className="flex items-center gap-2 text-[10px]">
            <span className={`w-3 h-3 rounded-sm shrink-0 ${palette[i % palette.length]}`} />
            <span className="flex-1 truncate text-gray-700">{sl.label}</span>
            <span className="font-mono text-indigo-700">{pct}%</span>
            <span className="font-mono text-gray-500 w-16 text-right">{Number(sl.value).toLocaleString()}</span>
          </div>
        );
      })}
    </div>
  );
}

// KPI grid — scalars + nested topBrands list when present.
function KpiGridView({ d }: { d: Record<string, unknown> }) {
  const topBrands = Array.isArray(d.topBrands) ? d.topBrands : null;
  const statusBreakdown = (d.statusBreakdown && typeof d.statusBreakdown === "object")
    ? d.statusBreakdown as Record<string, number>
    : null;

  // Scalars only — strip nested objects / arrays for the grid.
  const scalars = Object.entries(d).filter(([, v]) => {
    return v !== null && (typeof v !== "object" || v instanceof Date);
  });

  return (
    <div>
      {scalars.length > 0 && (
        <div className="grid grid-cols-2 gap-1">
          {scalars.map(([k, v]) => (
            <div key={k} className="bg-white rounded px-2 py-1">
              <div className="text-gray-500 text-[10px]">{k}</div>
              <div className="font-mono text-gray-900 truncate">
                {typeof v === "number" ? v.toLocaleString() : String(v)}
                {k.endsWith("Percent") || k.startsWith("growthRate") ? "%" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {topBrands && topBrands.length > 0 && (
        <div className="mt-2 pt-2 border-t border-indigo-200">
          <div className="text-[10px] text-indigo-600 font-semibold mb-1">Топ брэндүүд</div>
          <BarChartView d={{
            x: topBrands.map((b: { brand?: string }) => b.brand || "?"),
            y: topBrands.map((b: { revenue?: number }) => b.revenue || 0),
          }} />
        </div>
      )}
      {statusBreakdown && (
        <div className="mt-2 pt-2 border-t border-indigo-200">
          <div className="text-[10px] text-indigo-600 font-semibold mb-1">Захиалгын төлөв</div>
          <PieLegendView d={{
            slices: Object.entries(statusBreakdown).map(([label, value]) => ({ label, value })),
          }} />
        </div>
      )}
    </div>
  );
}
