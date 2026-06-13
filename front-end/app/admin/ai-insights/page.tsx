"use client";

/**
 * Admin AI Insights — the landing page for the weekly background-agent
 * digest notifications (back-end/Service/backgroundAgent.service.js).
 *
 * Those checks fire Notification rows with `type: "ai_insight"` and a
 * `data.kind` discriminator. The admin-targeted kinds are:
 *   • admin_market_gap_digest   — clustered zero-result searches
 *   • admin_financial_summary   — weekly revenue snapshot
 * Both link here, so this page reads the admin's own notifications via
 * GET /notifications, filters to those kinds, and renders them as a
 * readable digest.
 *
 * There is no dedicated insights endpoint — the underlying aggregations
 * (adminInsights.service.js) are only exposed through the AI chat tools,
 * not as a list API. The notification feed IS the persisted, queryable
 * record of what the agent surfaced, so we read it directly.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  Sparkles, RefreshCw, Loader2, TrendingUp, Search, ArrowRight, Bell, Lightbulb,
} from "lucide-react";
import {
  PageHeader, Card, CardSkeletons, EmptyState, btn,
} from "@/app/admin/_components/ui";

interface Notif {
  _id: string;
  type: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
  data?: { kind?: string } & Record<string, unknown>;
}

// Background-agent insight kinds that target admins (carried on
// notification.data.kind). Keep in sync with the CHECKS registry in
// back-end/Service/backgroundAgent.service.js.
const ADMIN_INSIGHT_KINDS = ["admin_market_gap_digest", "admin_financial_summary"] as const;

const KIND_META: Record<string, { label: string; icon: typeof Sparkles; color: string }> = {
  admin_market_gap_digest: {
    label: "Зах зээлийн цоорхой",
    icon: Search,
    color: "bg-amber-50 text-amber-700 border-amber-200",
  },
  admin_financial_summary: {
    label: "Санхүүгийн товч",
    icon: TrendingUp,
    color: "bg-blue-50 text-blue-700 border-blue-200",
  },
};

const isAdminInsight = (n: Notif) =>
  n.type === "ai_insight" &&
  typeof n.data?.kind === "string" &&
  (ADMIN_INSIGHT_KINDS as readonly string[]).includes(n.data.kind);

export default function AdminAiInsightsPage() {
  const [rows, setRows] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = () => {
    setLoading(true);
    api.get<{ items: Notif[]; unreadCount: number }>("/notifications?limit=100")
      .then((d) => setRows((d.items || []).filter(isAdminInsight)))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { queueMicrotask(reload); }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="AI дүгнэлт"
        icon={Lightbulb}
        subtitle="Системийн долоо хоног тутмын автомат дүгнэлтүүд — зах зээлийн цоорхой, санхүүгийн товч."
        actions={
          <button onClick={reload} disabled={loading} className={btn.primary}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Шинэчлэх
          </button>
        }
      />

      {/* What this is */}
      <div className="flex items-start gap-2.5 border border-amber-200 bg-amber-50 rounded-2xl p-3.5 text-[13px] text-amber-900">
        <Sparkles size={16} className="text-amber-500 shrink-0 mt-0.5" />
        <div>
          Background-agent долоо хоног тутам зах зээлийн цоорхой (хариугүй хайлтууд)
          болон санхүүгийн үзүүлэлтийг хянаж, анхаарал татах зүйл гарвал энд
          мэдэгдэл үүсгэдэг. Эдгээр нь таны хүлээн авсан AI дүгнэлтийн мэдэгдлүүд.
        </div>
      </div>

      {loading ? (
        <CardSkeletons count={3} height="h-20" />
      ) : rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={Bell}
            title="Одоогоор AI дүгнэлт алга"
            description="Систем долоо хоног тутам шинэ дүгнэлт үүсгэнэ. Анхаарал татах өөрчлөлт гармагц энд харагдана."
          />
        </Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-gray-100">
            {rows.map((n) => {
              const meta = KIND_META[n.data?.kind ?? ""] ?? {
                label: "Дүгнэлт", icon: Sparkles, color: "bg-gray-50 text-gray-600 border-gray-200",
              };
              const Icon = meta.icon;
              return (
                <div key={n._id} className="p-4 flex items-start gap-3">
                  <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${meta.color}`}>
                    <Icon size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full border text-[11px] font-medium ${meta.color}`}>
                        {meta.label}
                      </span>
                      {!n.read && (
                        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[11px] font-medium">
                          Шинэ
                        </span>
                      )}
                      <span className="text-[11px] text-gray-400">
                        {new Date(n.createdAt).toLocaleString("mn-MN")}
                      </span>
                    </div>
                    <div className="text-[14px] font-medium text-gray-900 mt-1.5">{n.title}</div>
                    {n.body && <div className="text-[13px] text-gray-600 leading-relaxed mt-0.5">{n.body}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Drill-downs into the live data behind the digests */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Link href="/admin/orders"
          className="group flex items-center justify-between border border-gray-200 rounded-2xl bg-white p-4 hover:border-blue-400 hover:shadow-sm transition-all">
          <div>
            <div className="text-[14px] font-medium text-gray-900">Захиалга, орлого</div>
            <div className="text-[12px] text-gray-500">Санхүүгийн товчид хамаарах захиалгуудыг үзэх.</div>
          </div>
          <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
        </Link>
        <Link href="/admin/products"
          className="group flex items-center justify-between border border-gray-200 rounded-2xl bg-white p-4 hover:border-blue-400 hover:shadow-sm transition-all">
          <div>
            <div className="text-[14px] font-medium text-gray-900">Бараа, нөөц</div>
            <div className="text-[12px] text-gray-500">Зах зээлийн цоорхойг нөхөх боломжтой барааг бүртгэх.</div>
          </div>
          <ArrowRight size={16} className="text-gray-300 group-hover:text-blue-500 transition-colors shrink-0" />
        </Link>
      </div>
    </div>
  );
}
