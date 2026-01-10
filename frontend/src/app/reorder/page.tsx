"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { InputHTMLAttributes } from "react";

import { authHeaders, clearAuth, getUser, type AuthUser } from "@/lib/auth";

/**
 * ✅ Logo note:
 * Put your logo here:
 *   frontend/public/assets/trdc.png
 * Then use:
 *   src="/assets/trdc.png"
 */

type ReorderItem = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;

  // NEW fields (lead time + safety stock)
  supplier?: string | null;
  lead_time_days: number;
  avg_daily_demand: number;
  safety_stock: number;

  quantity: number;

  // legacy field (keep optional so old backend won’t crash UI)
  low_stock_threshold?: number;

  // optional if backend sends them, otherwise frontend computes
  rop?: number;
  target_stock?: number;
  suggested_reorder?: number;
};

type UIStatus = "GOOD" | "LOW" | "OUT";

type SortMode =
  | "ORDER_DESC"
  | "ORDER_ASC"
  | "SKU"
  | "QTY_ASC"
  | "DEFICIT_DESC"
  | "ROP_DESC";

type ViewMode = "NEEDS_ORDER" | "ATTENTION";

type ToastVariant = "success" | "error";

const API = process.env.NEXT_PUBLIC_API_BASE_URL!;

function cleanCategory(x?: string | null) {
  const c = (x ?? "Uncategorized").trim();
  return c.length ? c : "Uncategorized";
}

function cleanText(x?: string | null, fallback = "—") {
  const t = (x ?? "").trim();
  return t.length ? t : fallback;
}

/* ---------- Lead time / Safety stock helpers ---------- */

function computeROP(x: ReorderItem) {
  // ROP = demand/day * lead time + safety stock
  const lead = Math.max(0, Number(x.lead_time_days ?? 0));
  const demand = Math.max(0, Number(x.avg_daily_demand ?? 0));
  const safety = Math.max(0, Number(x.safety_stock ?? 0));
  return Math.ceil(demand * lead + safety);
}

function computeTarget(x: ReorderItem, rop: number) {
  // order-up-to level = ROP + demand during lead time
  const lead = Math.max(0, Number(x.lead_time_days ?? 0));
  const demand = Math.max(0, Number(x.avg_daily_demand ?? 0));
  const extra = demand * lead;
  return Math.ceil(rop + extra);
}

/** ✅ FIXED / REVERTED STATUS: Out / Low / Good (user-centered) */
function computeStatus(x: ReorderItem, rop: number): UIStatus {
  const qty = Number(x.quantity ?? 0);
  if (qty === 0) return "OUT";
  if (qty <= rop) return "LOW";
  return "GOOD";
}

function statusLabel(s: UIStatus) {
  if (s === "OUT") return "Out";
  if (s === "LOW") return "Low";
  return "Good";
}

function StatusPill({ status }: { status: UIStatus }) {
  const styles =
    status === "OUT"
      ? "bg-rose-600/10 text-rose-700 border-rose-600/15"
      : status === "LOW"
      ? "bg-amber-500/10 text-amber-800 border-amber-500/15"
      : "bg-emerald-600/10 text-emerald-700 border-emerald-600/15";

  return (
    <span className={["text-xs px-2.5 py-1 rounded-full border font-semibold whitespace-nowrap", styles].join(" ")}>
      {statusLabel(status)}
    </span>
  );
}

export default function ReorderPage() {
  const router = useRouter();

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  const [items, setItems] = useState<ReorderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Account modal
  const [accountOpen, setAccountOpen] = useState(false);

  // UX controls
  const [viewMode, setViewMode] = useState<ViewMode>("NEEDS_ORDER");
  const [sortMode, setSortMode] = useState<SortMode>("ORDER_DESC");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");

  // Toast
  const [toast, setToast] = useState<null | { message: string; variant: ToastVariant }>(null);
  function showToast(message: string, variant: ToastVariant = "success") {
    setToast({ message, variant });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 3200);
  }

  function redirectToLogin() {
    clearAuth();
    router.replace("/login");
  }

  function makeHeaders(contentType?: boolean): HeadersInit {
    const base = authHeaders();
    const h = new Headers(base);

    if (contentType) h.set("Content-Type", "application/json");
    if (authUser?.name) h.set("X-Actor", authUser.name);

    return h;
  }

  async function fetchWithAuth(input: RequestInfo | URL, init?: RequestInit) {
    const res = await fetch(input, init);
    if (res.status === 401) {
      redirectToLogin();
      throw new Error("Session expired. Please login again.");
    }
    return res;
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithAuth(`${API}/api/reorder`, {
        headers: makeHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ReorderItem[];
      setItems(data);
    } catch (e: any) {
      const msg = e?.message ?? "Failed to load";
      setErr(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  }

  async function exportCsv() {
    try {
      const res = await fetchWithAuth(`${API}/api/reorder.csv`, {
        headers: makeHeaders(false),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "reorder.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      showToast("Export started.", "success");
    } catch (e: any) {
      showToast(e?.message ?? "Export failed", "error");
    }
  }

  // ✅ Require login for this page
  useEffect(() => {
    const u = getUser();
    if (!u) {
      router.replace("/login");
      return;
    }
    setAuthUser(u);
  }, [router]);

  // Load after authUser is known (prevents instant 401 spam)
  useEffect(() => {
    if (!authUser) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  // normalize + compute fields so the UI works even if backend doesn’t send rop/target/suggested
  const computed = useMemo(() => {
    return items.map((x) => {
      const rop = Number.isFinite(Number(x.rop)) ? Number(x.rop) : computeROP(x);
      const target = Number.isFinite(Number(x.target_stock)) ? Number(x.target_stock) : computeTarget(x, rop);

      const suggested = Number.isFinite(Number(x.suggested_reorder))
        ? Number(x.suggested_reorder)
        : Math.max(0, target - Number(x.quantity ?? 0));

      const status = computeStatus(x, rop);

      return { ...x, rop, target_stock: target, suggested_reorder: suggested, status };
    });
  }, [items]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const x of computed) s.add(cleanCategory(x.category));
    return ["ALL", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [computed]);

  const shown = useMemo(() => {
    let out = [...computed];

    // Search (SKU, name, category, supplier)
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((x) => {
        const cat = cleanCategory(x.category).toLowerCase();
        const sup = cleanText(x.supplier, "").toLowerCase();
        return (
          x.sku.toLowerCase().includes(q) ||
          x.name.toLowerCase().includes(q) ||
          cat.includes(q) ||
          sup.includes(q)
        );
      });
    }

    // Category filter
    if (category !== "ALL") {
      out = out.filter((x) => cleanCategory(x.category) === category);
    }

    // View mode
    if (viewMode === "NEEDS_ORDER") {
      out = out.filter((x) => (x.suggested_reorder ?? 0) > 0);
    } else {
      // ATTENTION: Out + Low
      out = out.filter((x) => x.status === "OUT" || x.status === "LOW");
    }

    // Sort
    out.sort((a, b) => {
      const deficitA = Math.max(0, (a.rop ?? 0) - a.quantity);
      const deficitB = Math.max(0, (b.rop ?? 0) - b.quantity);

      if (sortMode === "SKU") return a.sku.localeCompare(b.sku);
      if (sortMode === "QTY_ASC") return a.quantity - b.quantity;
      if (sortMode === "ORDER_ASC") return (a.suggested_reorder ?? 0) - (b.suggested_reorder ?? 0);
      if (sortMode === "DEFICIT_DESC") return deficitB - deficitA;
      if (sortMode === "ROP_DESC") return (b.rop ?? 0) - (a.rop ?? 0);
      return (b.suggested_reorder ?? 0) - (a.suggested_reorder ?? 0); // ORDER_DESC
    });

    return out;
  }, [computed, search, category, viewMode, sortMode]);

  const totals = useMemo(() => {
    const skuCount = shown.length;
    const totalUnits = shown.reduce((sum, x) => sum + (x.suggested_reorder ?? 0), 0);
    return { skuCount, totalUnits };
  }, [shown]);

  const attentionCount = useMemo(() => computed.filter((x) => (x.suggested_reorder ?? 0) > 0).length, [computed]);

  const counts = useMemo(() => {
    const outCount = computed.filter((x) => x.status === "OUT").length;
    const low = computed.filter((x) => x.status === "LOW").length;
    const good = computed.filter((x) => x.status === "GOOD").length;
    return { out: outCount, low, good };
  }, [computed]);

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#06130B]">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-[#081A10] via-[#040705] to-[#020403]" />
      <div className="pointer-events-none absolute z-0 -top-64 -left-64 h-[820px] w-[820px] rounded-full bg-emerald-400/25 blur-3xl" />
      <div className="pointer-events-none absolute z-0 -bottom-72 right-[-260px] h-[860px] w-[860px] rounded-full bg-green-500/20 blur-3xl" />
      <div className="pointer-events-none absolute z-0 top-24 left-1/2 -translate-x-1/2 h-[420px] w-[900px] rounded-full bg-emerald-300/10 blur-3xl" />

      {/* ✅ Floating logo (TOP LEFT) */}
      <Image
        src="/trdc.png"
        alt="TRDC Logo"
        width={400}
        height={120}
        priority
        className="
          pointer-events-none absolute top-0 left-6 z-50
          w-[140px] sm:w-[180px] lg:w-[220px]
          h-auto object-contain opacity-95
          brightness-0 invert
          drop-shadow-[0_10px_24px_rgba(0,0,0,0.35)]"
      />

      <div className="relative z-10 mx-auto max-w-[1560px] px-6 py-10">
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Sidebar */}
          <aside className="col-span-12 lg:col-span-2">
            <div className="rounded-[28px] overflow-hidden border border-white/10 shadow-[0_40px_140px_-80px_rgba(0,0,0,0.9)]">
              <div className="bg-gradient-to-b from-[#0B1B12] via-[#070B09] to-[#050605]">
                <div className="p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-white text-lg font-semibold tracking-tight">SupplySense</div>
                    <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-100 border border-emerald-400/20">
                      v0.5
                    </span>
                  </div>

                  <div className="mt-6 space-y-1.5">
                    <SideLink href="/" label="Products" />
                    <SideLink active href="/reorder" label="Reorder List" />
                  </div>

                  <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/60">Next best action</div>
                    <div className="mt-2 text-sm text-white/85">Export this list and send to purchasing.</div>
                    <button
                      onClick={exportCsv}
                      className="mt-3 inline-flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                    >
                      Export CSV
                    </button>
                    <div className="mt-2 text-[11px] text-white/45">
                      Includes: lead time, demand/day, safety, ROP, target, order now
                    </div>
                  </div>
                </div>

                <div className="border-t border-white/10 p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-10 w-10 rounded-2xl bg-white/10 border border-white/10" />
                      <div className="min-w-0">
                        <div className="text-sm text-white font-medium truncate">
                          {authUser?.name ?? "Not logged in"}
                        </div>
                        <div className="text-xs text-white/60 truncate">
                          {authUser?.role === "manager"
                            ? "Inventory Manager"
                            : authUser?.role === "viewer"
                            ? "Viewer (read-only)"
                            : "—"}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => setAccountOpen(true)}
                      className="rounded-xl px-3 py-2 text-xs font-semibold bg-white/10 text-white hover:bg-white/15 transition"
                      title="Account"
                    >
                      Account
                    </button>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2">
                    <Link
                      href="/"
                      className="inline-flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold bg-white/10 text-white hover:bg-white/15 transition"
                    >
                      ← Back to Products
                    </Link>

                    <button
                      onClick={() => {
                        clearAuth();
                        router.replace("/login");
                      }}
                      className="inline-flex w-full items-center justify-center rounded-xl px-3 py-2 text-sm font-semibold bg-white/5 text-white/80 hover:bg-white/10 transition"
                      title="Logout"
                    >
                      Logout
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="col-span-12 lg:col-span-10">
            <div className="rounded-[30px] overflow-hidden border border-white/60 shadow-[0_60px_160px_-90px_rgba(0,0,0,0.9)]">
              <div className="bg-gradient-to-b from-[#FBFEFB] to-[#EEF7EF]">
                {/* Header */}
                <div className="px-8 pt-8 pb-6 border-b border-emerald-100/80">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-sm text-zinc-500">Purchasing</div>
                      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">What to order right now</h1>
                      <div className="mt-2 text-sm text-zinc-500 max-w-[980px] leading-relaxed">
                        <span className="font-medium text-zinc-700">ROP</span> = demand/day × lead time + safety stock.{" "}
                        <span className="font-medium text-zinc-700">Out</span> when stock is 0,{" "}
                        <span className="font-medium text-zinc-700">Low</span> when stock is at/below ROP.
                      </div>
                      {err && <div className="mt-3 text-sm text-rose-700">Error: {err}</div>}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={load}
                        className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-zinc-200 shadow-sm hover:shadow transition"
                      >
                        Refresh
                      </button>
                      <button
                        onClick={exportCsv}
                        className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white shadow-sm hover:bg-emerald-700 transition"
                      >
                        Export CSV
                      </button>
                    </div>
                  </div>

                  {attentionCount > 0 && (
                    <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="text-sm text-rose-800">
                        <span className="font-semibold">{attentionCount}</span> items need ordering.
                      </div>
                      <button
                        onClick={exportCsv}
                        className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 transition"
                      >
                        Export and send
                      </button>
                    </div>
                  )}
                </div>

                <div className="p-8 space-y-6">
                  {/* KPI cards */}
                  <section className="grid grid-cols-12 gap-4">
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Needs ordering"
                      value={computed.filter((x) => (x.suggested_reorder ?? 0) > 0).length}
                      hint="Order now > 0"
                      tone="danger"
                      active={viewMode === "NEEDS_ORDER"}
                      onClick={() => setViewMode("NEEDS_ORDER")}
                    />
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Attention"
                      value={counts.out + counts.low}
                      hint="Out + Low"
                      tone="danger"
                      active={viewMode === "ATTENTION"}
                      onClick={() => setViewMode("ATTENTION")}
                    />
                    <MetricCard
                      className="col-span-12 md:col-span-3"
                      label="SKUs shown"
                      value={totals.skuCount}
                      hint="Matches your filters"
                      tone="neutral"
                    />
                    <MetricCard
                      className="col-span-12 md:col-span-3"
                      label="Total units to order"
                      value={totals.totalUnits.toLocaleString()}
                      hint="Sum of ‘Order now’"
                      tone="good"
                    />
                  </section>

                  {/* Search + Filters */}
                  <section className="rounded-2xl bg-white border border-emerald-100 shadow-[0_12px_34px_rgba(0,0,0,0.06)] p-6">
                    <div className="flex flex-col lg:flex-row lg:items-end gap-3 lg:justify-between">
                      <div className="flex-1">
                        <div className="text-xs font-medium text-zinc-500">Search</div>
                        <div className="mt-2">
                          <LightInput
                            placeholder="Search SKU, name, category, supplier…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <div>
                          <div className="text-xs font-medium text-zinc-500">Category</div>
                          <select
                            value={category}
                            onChange={(e) => setCategory(e.target.value)}
                            className="mt-2 w-full sm:w-[220px] rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                          >
                            {categories.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <div className="text-xs font-medium text-zinc-500">Sort</div>
                          <select
                            value={sortMode}
                            onChange={(e) => setSortMode(e.target.value as SortMode)}
                            className="mt-2 w-full sm:w-[270px] rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                          >
                            <option value="ORDER_DESC">Order now (high → low)</option>
                            <option value="ORDER_ASC">Order now (low → high)</option>
                            <option value="DEFICIT_DESC">Most urgent (below ROP)</option>
                            <option value="ROP_DESC">ROP (high → low)</option>
                            <option value="QTY_ASC">On hand (low → high)</option>
                            <option value="SKU">SKU (A → Z)</option>
                          </select>
                        </div>

                        <div className="flex items-end">
                          <button
                            onClick={() => {
                              setSearch("");
                              setCategory("ALL");
                              setViewMode("NEEDS_ORDER");
                              setSortMode("ORDER_DESC");
                            }}
                            className="w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-semibold bg-white border border-zinc-200 hover:shadow transition"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 text-xs text-zinc-500 leading-relaxed">
                      How it’s calculated: <span className="font-medium">ROP</span> = demand/day × lead time + safety,{" "}
                      <span className="font-medium">Target</span> = ROP + lead time demand,{" "}
                      <span className="font-medium">Order now</span> = max(0, target − on hand).
                    </div>
                  </section>

                  {/* Table */}
                  <section className="rounded-2xl bg-white border border-emerald-100 shadow-[0_12px_34px_rgba(0,0,0,0.06)] overflow-hidden">
                    <div className="px-6 py-5 border-b border-emerald-100">
                      <div className="text-xs font-medium text-zinc-500">Purchasing list</div>
                      <div className="text-lg font-semibold text-zinc-900 mt-1">Reorder recommendations</div>
                    </div>

                    {loading ? (
                      <div className="p-6">
                        <TableSkeleton rows={8} />
                      </div>
                    ) : items.length === 0 ? (
                      <EmptyState />
                    ) : shown.length === 0 ? (
                      <NoMatchesState
                        onReset={() => {
                          setSearch("");
                          setCategory("ALL");
                          setViewMode("NEEDS_ORDER");
                          setSortMode("ORDER_DESC");
                        }}
                      />
                    ) : (
                      <div className="w-full overflow-x-auto">
                        <table className="min-w-[1550px] w-full text-sm table-auto">
                          <thead className="bg-gradient-to-r from-emerald-50 to-white text-zinc-600">
                            <tr className="border-b border-emerald-100">
                              <th className="text-left font-medium px-4 py-4 w-[120px]">SKU</th>
                              <th className="text-left font-medium px-4 py-4">Item</th>
                              <th className="text-left font-medium px-4 py-4 w-[170px]">Supplier</th>
                              <th className="text-left font-medium px-4 py-4 w-[180px]">Category</th>

                              <th className="text-right font-medium px-4 py-4 w-[110px]">On hand</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Lead time</th>
                              <th className="text-right font-medium px-4 py-4 w-[140px]">Demand/day</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Safety</th>

                              <th className="text-right font-medium px-4 py-4 w-[120px]">ROP</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Below by</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Target</th>
                              <th className="text-right font-medium px-4 py-4 w-[170px]">Order now</th>
                              <th className="text-right font-medium px-4 py-4 w-[130px]">Status</th>
                            </tr>
                          </thead>

                          <tbody>
                            {shown.map((x) => {
                              const rop = x.rop ?? 0;
                              const target = x.target_stock ?? 0;
                              const suggested = x.suggested_reorder ?? 0;

                              const deficit = Math.max(0, rop - x.quantity);

                              const rowEmphasis =
                                x.status === "OUT" ? "bg-rose-50/55" : x.status === "LOW" ? "bg-amber-50/55" : "";

                              return (
                                <tr
                                  key={x.id}
                                  className={[
                                    "border-b border-emerald-50 hover:bg-emerald-50/50 transition",
                                    rowEmphasis,
                                  ].join(" ")}
                                >
                                  <td className="px-4 py-4 font-mono text-zinc-900">{x.sku}</td>

                                  <td className="px-4 py-4 text-zinc-900 font-medium">
                                    <div className="truncate">{x.name}</div>
                                  </td>

                                  <td className="px-4 py-4 text-zinc-700">
                                    <div className="truncate">{cleanText(x.supplier)}</div>
                                  </td>

                                  <td className="px-4 py-4 text-zinc-700">
                                    <div className="truncate">{cleanCategory(x.category)}</div>
                                  </td>

                                  <td className="px-4 py-4 text-right text-zinc-900 tabular-nums">{x.quantity}</td>

                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {Number(x.lead_time_days ?? 0)}d
                                  </td>

                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {Number(x.avg_daily_demand ?? 0).toFixed(2)}
                                  </td>

                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {Number(x.safety_stock ?? 0)}
                                  </td>

                                  <td className="px-4 py-4 text-right text-zinc-900 font-semibold tabular-nums">{rop}</td>

                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {deficit === 0 ? "—" : deficit}
                                  </td>

                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">{target}</td>

                                  <td className="px-4 py-4 text-right">
                                    <span className="inline-flex items-center justify-end gap-2">
                                      <span className="text-zinc-900 font-semibold tabular-nums">{suggested}</span>
                                      <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-600/10 text-emerald-700 border border-emerald-600/15">
                                        units
                                      </span>
                                    </span>
                                  </td>

                                  <td className="px-4 py-4 text-right">
                                    <StatusPill status={x.status as UIStatus} />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>

      {/* Account modal */}
      {accountOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAccountOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white border border-zinc-200 shadow-[0_30px_90px_rgba(0,0,0,0.28)] overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-200">
              <div className="text-xs font-medium text-zinc-500">Account</div>
              <div className="text-lg font-semibold text-zinc-900 mt-1">Signed in</div>
              <div className="mt-2 text-sm text-zinc-600">
                This page uses your JWT token. Role controls what you can edit.
              </div>
            </div>

            <div className="px-6 py-5 space-y-3">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Name</div>
                <div className="text-sm font-semibold text-zinc-900">{authUser?.name ?? "—"}</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="text-xs text-zinc-500">Role</div>
                <div className="text-sm font-semibold text-zinc-900">
                  {authUser?.role ?? "—"} {authUser?.role === "viewer" ? "(read-only)" : ""}
                </div>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-zinc-200 flex justify-end gap-2">
              <button
                onClick={() => setAccountOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
              >
                Close
              </button>
              <button
                onClick={() => {
                  clearAuth();
                  router.replace("/login");
                }}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-full max-w-lg px-6">
          <div
            className={[
              "rounded-2xl border shadow-[0_20px_60px_rgba(0,0,0,0.18)] px-4 py-3 flex items-center justify-between gap-3",
              toast.variant === "error" ? "bg-rose-50 border-rose-200" : "bg-white border-zinc-200",
            ].join(" ")}
          >
            <div className={["text-sm", toast.variant === "error" ? "text-rose-800" : "text-zinc-800"].join(" ")}>
              {toast.message}
            </div>
            <button
              onClick={() => setToast(null)}
              className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- UI components ---------- */

function SideLink({ label, active, href }: { label: string; active?: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={[
        "block w-full text-left px-4 py-3 rounded-2xl border transition",
        active
          ? "bg-emerald-500/15 border-emerald-400/20 text-emerald-50"
          : "bg-white/0 border-white/0 hover:bg-white/5 hover:border-white/10 text-white/85",
      ].join(" ")}
    >
      <div className="text-sm font-medium">{label}</div>
    </Link>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone,
  className = "",
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: "neutral" | "good" | "danger";
  className?: string;
}) {
  const bg =
    tone === "danger"
      ? "bg-[linear-gradient(180deg,#FFFFFF,rgba(244,63,94,0.03))]"
      : tone === "good"
      ? "bg-[linear-gradient(180deg,#FFFFFF,rgba(16,185,129,0.06))]"
      : "bg-[linear-gradient(180deg,#FFFFFF,rgba(16,185,129,0.035))]";

  return (
    <div
      className={[
        "rounded-2xl border border-emerald-100 shadow-[0_12px_34px_rgba(0,0,0,0.06)] px-6 py-5",
        bg,
        className,
      ].join(" ")}
    >
      <div className="text-sm text-zinc-600">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </div>
  );
}

function MetricButton({
  label,
  value,
  hint,
  tone,
  className = "",
  active,
  onClick,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: "neutral" | "good" | "danger";
  className?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const bg =
    tone === "danger"
      ? "bg-[linear-gradient(180deg,#FFFFFF,rgba(244,63,94,0.05))]"
      : tone === "good"
      ? "bg-[linear-gradient(180deg,#FFFFFF,rgba(16,185,129,0.07))]"
      : "bg-[linear-gradient(180deg,#FFFFFF,rgba(16,185,129,0.04))]";

  return (
    <button
      onClick={onClick}
      className={[
        "text-left rounded-2xl border shadow-[0_12px_34px_rgba(0,0,0,0.06)] px-6 py-5 transition",
        bg,
        active ? "border-emerald-400 ring-4 ring-emerald-500/10" : "border-emerald-100 hover:shadow",
        className,
      ].join(" ")}
    >
      <div className="text-sm text-zinc-600">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{hint}</div>
    </button>
  );
}

function LightInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return (
    <input
      {...rest}
      className={[
        "w-full rounded-xl px-4 py-3 text-sm",
        "bg-white border border-zinc-200 shadow-sm",
        "outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15 transition",
        className,
      ].join(" ")}
    />
  );
}

/* ---------- Skeleton + Empty states ---------- */

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={["h-3 rounded-full bg-zinc-200/70 animate-pulse", className].join(" ")} />;
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-[1550px] w-full text-sm table-auto">
        <thead className="bg-gradient-to-r from-emerald-50 to-white text-zinc-600">
          <tr className="border-b border-emerald-100">
            {Array.from({ length: 13 }).map((_, i) => (
              <th key={i} className="text-left font-medium px-4 py-4">
                <SkeletonLine className="w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-emerald-50">
              {Array.from({ length: 13 }).map((_, c) => (
                <td key={c} className="px-4 py-4">
                  <SkeletonLine className={c === 1 ? "w-56" : "w-24"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="p-10">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-8">
        <div className="text-lg font-semibold text-zinc-900">No reorder items yet</div>
        <div className="mt-2 text-sm text-zinc-600 max-w-[820px]">
          Once you add products (and set lead time, demand/day, safety stock), this page will compute what to order.
        </div>
        <div className="mt-5">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition"
          >
            Go to Products
          </Link>
        </div>
      </div>
    </div>
  );
}

function NoMatchesState({ onReset }: { onReset: () => void }) {
  return (
    <div className="p-10">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8">
        <div className="text-lg font-semibold text-zinc-900">Nothing matches</div>
        <div className="mt-2 text-sm text-zinc-600">Try changing filters or reset to defaults.</div>
        <div className="mt-5">
          <button
            onClick={onReset}
            className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition"
          >
            Reset filters
          </button>
        </div>
      </div>
    </div>
  );
}
