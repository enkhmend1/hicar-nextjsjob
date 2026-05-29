"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Brain, Search, Plus, Pencil, Trash2, X, RefreshCw, Sparkles } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────
interface SearchLog {
  _id: string;
  query: string;
  expandedQuery: string;
  category: string;
  resultCount: number;
  source: "ai" | "shop" | "voice" | "image";
  createdAt: string;
}

interface OemMapping {
  _id: string;
  keyword: string;
  category: string;
  oemHint: string;
  note: string;
  enabled: boolean;
  usageCount: number;
  createdAt: string;
}

interface ZeroQuery { query: string; count: number; lastAt: string }

const CATEGORIES = [
  { id: "", label: "—" },
  { id: "brake", label: "Тоормос" },
  { id: "engine", label: "Хөдөлгүүр" },
  { id: "lighting", label: "Гэрэлтүүлэг" },
  { id: "suspension", label: "Амортизатор" },
  { id: "electric", label: "Цахилгаан" },
  { id: "body", label: "Бие дарц" },
  { id: "transmission", label: "Дамжуулга" },
  { id: "other", label: "Бусад" },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.id, c.label]));

const SOURCE_COLOR: Record<string, string> = {
  ai: "bg-blue-50 text-blue-700",
  shop: "bg-blue-50 text-blue-700",
  voice: "bg-emerald-50 text-emerald-700",
  image: "bg-amber-50 text-amber-700",
};

// ── Page ─────────────────────────────────────────────────────────
export default function AdminTrainingPage() {
  const [tab, setTab] = useState<"logs" | "mappings">("logs");
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold text-gray-900 flex items-center gap-2">
            <Brain size={20} className="text-blue-500" /> AI сургалтын самбар
          </h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Хайлтын логыг хянаж, AI-н OEM таних ур чадварыг сайжруулна.
          </p>
        </div>
        <button onClick={refresh}
          className="flex items-center gap-1.5 border border-gray-200 hover:border-blue-400 rounded-lg px-3 py-1.5 text-[12px] text-gray-600 cursor-pointer bg-white transition-colors font-sans">
          <RefreshCw size={12} /> Сэргээх
        </button>
      </header>

      <div className="flex gap-1 border-b border-gray-200">
        {([
          { id: "logs", label: "Хайлтын лог" },
          { id: "mappings", label: "OEM mappings" },
        ] as const).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-[13px] font-medium cursor-pointer bg-transparent border-none border-b-2 transition-colors font-sans ${
              tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "logs"
        ? <LogsTab key={`logs-${refreshKey}`} onChange={refresh} />
        : <MappingsTab key={`maps-${refreshKey}`} />}
    </div>
  );
}

// ── Logs tab ─────────────────────────────────────────────────────
function LogsTab({ onChange }: { onChange: () => void }) {
  const [logs, setLogs] = useState<SearchLog[]>([]);
  const [zero, setZero] = useState<ZeroQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [zeroOnly, setZeroOnly] = useState(false);
  const [source, setSource] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const usp = new URLSearchParams();
      if (zeroOnly) usp.set("zeroOnly", "true");
      if (source !== "all") usp.set("source", source);
      const [{ logs }, { queries }] = await Promise.all([
        api.get<{ logs: SearchLog[] }>(`/training/logs?${usp.toString()}`),
        api.get<{ queries: ZeroQuery[] }>("/training/zero-results"),
      ]);
      setLogs(logs);
      setZero(queries);
    } finally {
      setLoading(false);
    }
  }, [zeroOnly, source]);

  // queueMicrotask defers load()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(load); }, [load]);

  const seedMapping = async (q: ZeroQuery) => {
    const cat = prompt(`"${q.query}" — ангилал? (${CATEGORIES.filter(c => c.id).map(c => c.id).join(" | ")})`, "other");
    if (cat === null) return;
    try {
      await api.post("/training/mappings/from-query", { query: q.query, category: cat });
      onChange();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  return (
    <>
      {zero.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles size={14} className="text-amber-600" />
            <h2 className="text-[14px] font-semibold text-amber-900">Сүүлийн 30 хоногт үр дүнгүй хайлтууд (top {zero.length})</h2>
          </div>
          <p className="text-[11px] text-amber-700 mb-3">
            Эдгээр query-уудад mapping үүсгэснээр AI цаашид зөв ангилалд хайх болно.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {zero.map(q => (
              <li key={q.query} className="flex items-center justify-between gap-2 bg-white border border-amber-100 rounded-lg px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-gray-900 truncate">{q.query}</div>
                  <div className="text-[10px] text-gray-400">×{q.count} · {new Date(q.lastAt).toLocaleDateString("mn-MN")}</div>
                </div>
                <button onClick={() => seedMapping(q)} title="Mapping үүсгэх"
                  className="w-6 h-6 inline-flex items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border border-blue-200 shrink-0">
                  <Plus size={11} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
          <h2 className="text-[14px] font-semibold text-gray-900 flex-1">Хайлтын лог ({logs.length})</h2>
          <label className="flex items-center gap-1.5 text-[12px] text-gray-600 cursor-pointer">
            <input type="checkbox" checked={zeroOnly} onChange={e => setZeroOnly(e.target.checked)}
              className="accent-blue-600 w-3.5 h-3.5" /> Зөвхөн үр дүнгүй
          </label>
          <select value={source} onChange={e => setSource(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] focus:border-blue-500 outline-none font-sans">
            <option value="all">Бүх эх сурвалж</option>
            <option value="ai">AI chat</option>
            <option value="shop">Дэлгүүр хайлт</option>
            <option value="voice">Voice</option>
            <option value="image">Image</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500">
                <th className="text-left px-4 py-2 font-medium">Огноо</th>
                <th className="text-left px-4 py-2 font-medium">Эх сурвалж</th>
                <th className="text-left px-4 py-2 font-medium">Query</th>
                <th className="text-left px-4 py-2 font-medium">Expanded</th>
                <th className="text-left px-4 py-2 font-medium">Ангилал</th>
                <th className="text-right px-4 py-2 font-medium">Үр дүн</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Уншиж байна...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Лог байхгүй</td></tr>
              ) : logs.map(l => (
                <tr key={l._id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{new Date(l.createdAt).toLocaleString("mn-MN")}</td>
                  <td className="px-4 py-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${SOURCE_COLOR[l.source] ?? "bg-gray-100 text-gray-600"}`}>
                      {l.source}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-medium text-gray-900 max-w-xs truncate">{l.query}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-xs truncate font-mono text-[11px]">{l.expandedQuery || "—"}</td>
                  <td className="px-4 py-2 text-gray-600">{CATEGORY_LABEL[l.category] || "—"}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${l.resultCount === 0 ? "text-red-600" : "text-gray-700"}`}>
                    {l.resultCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ── Mappings tab ─────────────────────────────────────────────────
function MappingsTab() {
  const [items, setItems] = useState<OemMapping[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<OemMapping> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const usp = new URLSearchParams();
      if (q) usp.set("q", q);
      if (category !== "all") usp.set("category", category);
      const { items } = await api.get<{ items: OemMapping[] }>(`/training/mappings?${usp.toString()}`);
      setItems(items);
    } finally {
      setLoading(false);
    }
  }, [q, category]);

  // queueMicrotask defers load()'s setLoading(true) past the effect
  // commit — React 19 warns on sync setState in effect bodies.
  useEffect(() => { queueMicrotask(load); }, [load]);

  const totalUsage = useMemo(() => items.reduce((s, i) => s + (i.usageCount || 0), 0), [items]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true); setErr("");
    try {
      const body = {
        keyword: editing.keyword?.trim().toLowerCase(),
        category: editing.category || "",
        oemHint: editing.oemHint?.trim() || "",
        note: editing.note?.trim() || "",
        enabled: editing.enabled !== false,
      };
      if (editing._id) await api.put(`/training/mappings/${editing._id}`, body);
      else await api.post("/training/mappings", body);
      setEditing(null);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: OemMapping) => {
    if (!confirm(`"${m.keyword}" mapping-г устгах уу?`)) return;
    await api.delete(`/training/mappings/${m._id}`);
    load();
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)}
            className="w-full bg-white border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-[13px] focus:border-blue-500 outline-none"
            placeholder="Keyword хайх..." />
        </div>
        <select value={category} onChange={e => setCategory(e.target.value)}
          className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 outline-none font-sans">
          <option value="all">Бүх ангилал</option>
          {CATEGORIES.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button onClick={() => setEditing({ keyword: "", category: "", oemHint: "", note: "", enabled: true })}
          className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-3 py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
          <Plus size={13} /> Mapping нэмэх
        </button>
      </div>

      <div className="text-[11px] text-gray-400">
        Нийт {items.length} mapping · Нийт хэрэглэсэн {totalUsage}
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-[12px]">
                <th className="text-left px-4 py-2.5 font-medium">Keyword</th>
                <th className="text-left px-4 py-2.5 font-medium">Ангилал</th>
                <th className="text-left px-4 py-2.5 font-medium">OEM hint</th>
                <th className="text-center px-4 py-2.5 font-medium">Идэвхтэй</th>
                <th className="text-right px-4 py-2.5 font-medium">Хэрэглэсэн</th>
                <th className="text-right px-4 py-2.5 font-medium">Үйлдэл</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Уншиж байна...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">Mapping байхгүй. Үр дүнгүй query-аас үүсгэх боломжтой.</td></tr>
              ) : items.map(m => (
                <tr key={m._id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900">{m.keyword}</div>
                    {m.note && <div className="text-[11px] text-gray-400 truncate max-w-[260px]">{m.note}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{CATEGORY_LABEL[m.category] || "—"}</td>
                  <td className="px-4 py-2.5 text-gray-500 font-mono text-[12px]">{m.oemHint || "—"}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${m.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {m.enabled ? "Идэвхтэй" : "Идэвхгүй"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">{m.usageCount}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(m)} title="Засах"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 cursor-pointer bg-transparent border-none transition-colors mr-1">
                      <Pencil size={13} />
                    </button>
                    <button onClick={() => remove(m)} title="Устгах"
                      className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer bg-transparent border-none transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setEditing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-gray-900">
                {editing._id ? "Mapping засах" : "Шинэ mapping"}
              </h2>
              <button onClick={() => setEditing(null)} className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-700 cursor-pointer bg-transparent border-none">
                <X size={15} />
              </button>
            </div>
            <form onSubmit={save} className="p-5 space-y-3">
              {err && <div className="bg-red-50 border border-red-200 text-red-600 text-[12px] rounded-lg px-3 py-2">{err}</div>}
              <Field label="Keyword (substring, lowercase автоматаар хувирна)">
                <input required value={editing.keyword ?? ""} onChange={e => setEditing(s => ({ ...s, keyword: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none"
                  placeholder="жнь: приус мотор, 30 inverter" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ангилал">
                  <select value={editing.category ?? ""} onChange={e => setEditing(s => ({ ...s, category: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none font-sans">
                    {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label || "—"}</option>)}
                  </select>
                </Field>
                <Field label="OEM hint (заавал биш)">
                  <input value={editing.oemHint ?? ""} onChange={e => setEditing(s => ({ ...s, oemHint: e.target.value }))}
                    className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none font-mono"
                    placeholder="43512" />
                </Field>
              </div>
              <Field label="Тэмдэглэл (заавал биш)">
                <textarea value={editing.note ?? ""} onChange={e => setEditing(s => ({ ...s, note: e.target.value }))}
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[13px] focus:border-blue-500 focus:bg-white outline-none resize-none h-20 font-sans"
                  placeholder="Энэ mapping нь яагаад зөв вэ..." />
              </Field>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.enabled !== false} onChange={e => setEditing(s => ({ ...s, enabled: e.target.checked }))}
                  className="accent-blue-600 w-4 h-4" />
                <span className="text-[13px] text-gray-700">Идэвхтэй</span>
              </label>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} disabled={busy}
                  className="flex-1 border border-gray-200 rounded-lg py-2 text-[13px] text-gray-600 cursor-pointer bg-white font-sans">
                  Болих
                </button>
                <button type="submit" disabled={busy}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-lg py-2 text-[13px] font-semibold cursor-pointer border-none transition-colors font-sans">
                  {busy ? "Хадгалж байна..." : "Хадгалах"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
