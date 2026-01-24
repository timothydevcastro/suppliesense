"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { authHeaders, clearAuth, getUser, type AuthUser } from "@/lib/auth";

type Product = {
  id: string;
  sku: string;
  name: string;
  category?: string | null;
  supplier?: string | null;

  quantity: number;

  // New fields
  lead_time_days?: number | null;
  avg_daily_demand?: number | null;
  safety_stock?: number | null;

  // legacy / fallback backend field (we still send it for compatibility)
  low_stock_threshold: number;
};

type ProductCreate = {
  sku: string;
  name: string;
  category?: string;
  supplier?: string;

  quantity: number;

  lead_time_days: number;
  avg_daily_demand: number;
  safety_stock: number;

  // we still send this to backend (computed)
  low_stock_threshold: number;
};

type ProductEditDraft = {
  name: string;
  category: string;
  supplier: string;

  lead_time_days: number;
  avg_daily_demand: number;
  safety_stock: number;
};

type UIStatus = "GOOD" | "LOW" | "OUT";

type TableFilter = "ALL" | "ATTENTION" | "LOW" | "OUT" | "GOOD";
type SortMode = "ATTENTION" | "SKU" | "QTY_ASC" | "QTY_DESC";

type ToastVariant = "success" | "error";

type AuditLog = {
  id: number;
  action: string;
  product_id: number;
  sku: string;
  name: string;
  prev_quantity: number;
  new_quantity: number;
  delta: number;
  actor: string;
  ip?: string | null;
  created_at?: string | null;
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL!;

/** ROP = demand * lead time + safety stock */
function calcROP(input: {
  lead_time_days?: number | null;
  avg_daily_demand?: number | null;
  safety_stock?: number | null;
}) {
  const lt = Number(input.lead_time_days ?? 0) || 0;
  const d = Number(input.avg_daily_demand ?? 0) || 0;
  const ss = Number(input.safety_stock ?? 0) || 0;
  const rop = d * lt + ss;
  return Math.max(0, Math.ceil(rop));
}

/** Use new formula if fields exist, else fallback to old low_stock_threshold */
function getReorderPoint(p: Product) {
  const hasNew =
    p.lead_time_days !== null &&
    p.lead_time_days !== undefined &&
    p.avg_daily_demand !== null &&
    p.avg_daily_demand !== undefined &&
    p.safety_stock !== null &&
    p.safety_stock !== undefined;

  return hasNew ? calcROP(p) : Number(p.low_stock_threshold ?? 0) || 0;
}

function getUIStatus(p: Product): UIStatus {
  const qty = Number(p.quantity ?? 0) || 0;
  const rop = getReorderPoint(p);

  if (qty === 0) return "OUT";
  if (qty <= rop) return "LOW";
  return "GOOD";
}

function statusLabel(s: UIStatus) {
  if (s === "OUT") return "Out";
  if (s === "LOW") return "Low";
  return "Good";
}

function statusRank(s: UIStatus) {
  if (s === "OUT") return 0;
  if (s === "LOW") return 1;
  return 2;
}

function prettyAction(action: string) {
  if (action === "stock_update") return "Stock update";
  if (action === "product_create") return "Product created";
  if (action === "product_update") return "Product updated";
  if (action === "product_delete") return "Product deleted";
  return action;
}

function fmtWhen(createdAt?: string | null) {
  if (!createdAt) return "—";
  try {
    const d = new Date(createdAt);
    if (Number.isNaN(d.getTime())) return createdAt;
    return d.toLocaleString();
  } catch {
    return createdAt;
  }
}

export default function Home() {
  const router = useRouter();

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const canWrite = authUser?.role === "manager";

  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Account modal
  const [accountOpen, setAccountOpen] = useState(false);

  // History modal
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [historyLogs, setHistoryLogs] = useState<AuditLog[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState<string | null>(null);

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const skuInputRef = useRef<HTMLInputElement>(null);

  // Add form
  const [form, setForm] = useState<ProductCreate>({
    sku: "",
    name: "",
    category: "",
    supplier: "",
    quantity: 0,

    lead_time_days: 7,
    avg_daily_demand: 1,
    safety_stock: 5,

    low_stock_threshold: 10, // computed right before POST
  });

  // Row edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<ProductEditDraft>({
    name: "",
    category: "",
    supplier: "",

    lead_time_days: 7,
    avg_daily_demand: 1,
    safety_stock: 5,
  });
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  // Qty busy (for stepper)
  const [qtyBusyId, setQtyBusyId] = useState<string | null>(null);
  const [stepSize, setStepSize] = useState<number>(5);

  // Filters
  const [tableFilter, setTableFilter] = useState<TableFilter>("ATTENTION");
  const [sortMode, setSortMode] = useState<SortMode>("ATTENTION");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // Delete modal
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Toast with Undo + variants
  const [toast, setToast] = useState<null | {
    message: string;
    variant: ToastVariant;
    undo?: () => void;
  }>(null);

  function showToast(message: string, variant: ToastVariant = "success", undo?: () => void) {
    setToast({ message, variant, undo });
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToast(null), 3200);
  }

  function showError(e: any, fallback = "Something went wrong") {
    const msg = typeof e === "string" ? e : e?.message ?? fallback;
    showToast(msg, "error");
  }

  function redirectToLogin() {
    clearAuth();
    router.replace("/login");
  }

  function ensureManager() {
    if (!authUser) {
      redirectToLogin();
      return false;
    }
    if (authUser.role !== "manager") {
      showToast("Viewer account is read-only.", "error");
      return false;
    }
    return true;
  }

  // ✅ Auth headers (Authorization + optional X-Actor)
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

  function openAddModal() {
    if (!ensureManager()) return;
    setAddOpen(true);
    setTimeout(() => skuInputRef.current?.focus(), 80);
  }

  function closeAddModal() {
    setAddOpen(false);
  }

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetchWithAuth(`${API}/api/products`, {
        headers: makeHeaders(false),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Product[];
      setItems(data);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load");
      showError(e, "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function addProduct() {
    try {
      if (!ensureManager()) return;

      if (!form.sku.trim() || !form.name.trim()) {
        showToast("SKU and Name are required.", "error");
        return;
      }

      const lead = Number(form.lead_time_days) || 0;
      const demand = Number(form.avg_daily_demand) || 0;
      const safety = Number(form.safety_stock) || 0;

      if (lead < 0 || demand < 0 || safety < 0 || Number(form.quantity) < 0) {
        showToast("Numbers must be 0 or higher.", "error");
        return;
      }

      const computedROP = calcROP({
        lead_time_days: lead,
        avg_daily_demand: demand,
        safety_stock: safety,
      });

      const payload: ProductCreate = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category?.trim() ? form.category.trim() : undefined,
        supplier: form.supplier?.trim() ? form.supplier.trim() : undefined,
        quantity: Number(form.quantity) || 0,

        lead_time_days: lead,
        avg_daily_demand: demand,
        safety_stock: safety,

        low_stock_threshold: computedROP,
      };

      const res = await fetchWithAuth(`${API}/api/products`, {
        method: "POST",
        headers: makeHeaders(true),
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }

      setForm({
        sku: "",
        name: "",
        category: "",
        supplier: "",
        quantity: 0,

        lead_time_days: 7,
        avg_daily_demand: 1,
        safety_stock: 5,

        low_stock_threshold: 10,
      });

      await load();
      showToast("Product added.", "success");
      closeAddModal();
    } catch (e: any) {
      showError(e, "Failed to add product");
    }
  }

  function startEdit(p: Product) {
    if (!ensureManager()) return;

    setEditingId(p.id);
    setEditDraft({
      name: p.name ?? "",
      category: p.category ?? "",
      supplier: p.supplier ?? "",

      lead_time_days: Number(p.lead_time_days ?? 7) || 0,
      avg_daily_demand: Number(p.avg_daily_demand ?? 1) || 0,
      safety_stock: Number(p.safety_stock ?? 5) || 0,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setRowBusyId(null);
  }

  async function saveEdit(product: Product) {
    if (!ensureManager()) return;

    const name = editDraft.name.trim();
    const categoryTrim = editDraft.category.trim();
    const supplierTrim = editDraft.supplier.trim();

    const lead = Number(editDraft.lead_time_days) || 0;
    const demand = Number(editDraft.avg_daily_demand) || 0;
    const safety = Number(editDraft.safety_stock) || 0;

    if (!name) {
      showToast("Name cannot be empty.", "error");
      return;
    }
    if (lead < 0 || demand < 0 || safety < 0) {
      showToast("Numbers must be 0 or higher.", "error");
      return;
    }

    const computedROP = calcROP({
      lead_time_days: lead,
      avg_daily_demand: demand,
      safety_stock: safety,
    });

    setRowBusyId(product.id);

    try {
      const res = await fetchWithAuth(`${API}/api/products/${product.id}`, {
        method: "PATCH",
        headers: makeHeaders(true),
        body: JSON.stringify({
          name,
          category: categoryTrim ? categoryTrim : null,
          supplier: supplierTrim ? supplierTrim : null,

          lead_time_days: lead,
          avg_daily_demand: demand,
          safety_stock: safety,

          low_stock_threshold: computedROP,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }

      const updated = (await res.json()) as Product;
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

      setEditingId(null);
      setRowBusyId(null);
      showToast("Saved.", "success");
    } catch (e: any) {
      setRowBusyId(null);
      showError(e, "Failed to update product");
    }
  }

  async function patchStock(productId: string, nextQty: number) {
    if (nextQty < 0) nextQty = 0;

    const res = await fetchWithAuth(`${API}/api/products/${productId}/stock`, {
      method: "PATCH",
      headers: makeHeaders(true),
      body: JSON.stringify({ quantity: nextQty }),
    });

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(msg);
    }

    return (await res.json()) as Product;
  }

  async function adjustQty(p: Product, delta: number) {
    if (!ensureManager()) return;

    const prevQty = p.quantity ?? 0;
    const next = Math.max(0, prevQty + delta);
    if (next === prevQty) return;

    setQtyBusyId(p.id);
    try {
      const updated = await patchStock(p.id, next);
      setItems((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));

      showToast(`${p.name} updated to ${next}.`, "success", async () => {
        try {
          const undoed = await patchStock(p.id, prevQty);
          setItems((prev) => prev.map((x) => (x.id === undoed.id ? undoed : x)));
          showToast("Undone.", "success");
        } catch (e: any) {
          showError(e, "Undo failed.");
        }
      });
    } catch (e: any) {
      showError(e, "Failed to adjust quantity");
    } finally {
      setQtyBusyId(null);
    }
  }

  function requestDelete(p: Product) {
    if (!ensureManager()) return;
    setDeleteTarget(p);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    if (!ensureManager()) return;

    setDeleteBusy(true);
    try {
      const res = await fetchWithAuth(`${API}/api/products/${deleteTarget.id}`, {
        method: "DELETE",
        headers: makeHeaders(false),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg);
      }

      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteBusy(false);
      showToast("Deleted.", "success");
    } catch (e: any) {
      setDeleteBusy(false);
      showError(e, "Failed to delete product");
    }
  }

  async function openHistory(p: Product) {
    setHistoryProduct(p);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryErr(null);
    setHistoryLogs([]);

    try {
      const res = await fetchWithAuth(
        `${API}/api/audit-logs?product_id=${encodeURIComponent(p.id)}&limit=100`,
        {
          headers: makeHeaders(false),
        }
      );
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as AuditLog[];
      setHistoryLogs(data);
    } catch (e: any) {
      setHistoryErr(e?.message ?? "Failed to load history");
    } finally {
      setHistoryLoading(false);
    }
  }

  function closeHistory() {
    setHistoryOpen(false);
    setHistoryProduct(null);
    setHistoryLogs([]);
    setHistoryErr(null);
    setHistoryLoading(false);
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

  // close add modal on ESC
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addOpen]);

  // close history modal on ESC
  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeHistory();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  const categories = useMemo(() => {
    const s = new Set<string>();
    for (const p of items) s.add((p.category ?? "Uncategorized").trim());
    return ["ALL", ...Array.from(s).sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const stats = useMemo(() => {
    const out = items.filter((p) => getUIStatus(p) === "OUT").length;
    const low = items.filter((p) => getUIStatus(p) === "LOW").length;
    const good = items.filter((p) => getUIStatus(p) === "GOOD").length;
    const totalQty = items.reduce((sum, p) => sum + (p.quantity ?? 0), 0);
    return { total: items.length, out, low, good, totalQty };
  }, [items]);

  const shownItems = useMemo(() => {
    let out = [...items];

    // search
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter((p) => {
        const cat = (p.category ?? "Uncategorized").toLowerCase();
        const sup = (p.supplier ?? "").toLowerCase();
        return (
          p.sku.toLowerCase().includes(q) ||
          p.name.toLowerCase().includes(q) ||
          cat.includes(q) ||
          sup.includes(q)
        );
      });
    }

    // category filter
    if (categoryFilter !== "ALL") {
      out = out.filter((p) => (p.category ?? "Uncategorized").trim() === categoryFilter);
    }

    // table filter
    out = out.filter((p) => {
      const s = getUIStatus(p);
      if (tableFilter === "ALL") return true;
      if (tableFilter === "ATTENTION") return s === "OUT" || s === "LOW";
      if (tableFilter === "LOW") return s === "LOW";
      if (tableFilter === "OUT") return s === "OUT";
      return s === "GOOD";
    });

    // sort
    out.sort((a, b) => {
      if (sortMode === "SKU") return a.sku.localeCompare(b.sku);
      if (sortMode === "QTY_ASC") return (a.quantity ?? 0) - (b.quantity ?? 0);
      if (sortMode === "QTY_DESC") return (b.quantity ?? 0) - (a.quantity ?? 0);

      const sa = getUIStatus(a);
      const sb = getUIStatus(b);
      const r = statusRank(sa) - statusRank(sb);
      if (r !== 0) return r;

      const ropA = getReorderPoint(a);
      const ropB = getReorderPoint(b);
      const deficitA = Math.max(0, ropA - (a.quantity ?? 0));
      const deficitB = Math.max(0, ropB - (b.quantity ?? 0));
      return deficitB - deficitA;
    });

    return out;
  }, [items, search, categoryFilter, tableFilter, sortMode]);

  const attentionBannerCount = useMemo(
    () =>
      items.filter((p) => {
        const s = getUIStatus(p);
        return s === "OUT" || s === "LOW";
      }).length,
    [items]
  );

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#06130B]">
      {/* floating logo (TOP LEFT) — overlay, doesn’t affect layout */}
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
          drop-shadow-[0_10px_24px_rgba(0,0,0,0.35)]
        "
      />

      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#081A10] via-[#040705] to-[#020403]" />
      <div className="pointer-events-none absolute -top-64 -left-64 h-[820px] w-[820px] rounded-full bg-emerald-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-72 right-[-260px] h-[860px] w-[860px] rounded-full bg-green-500/20 blur-3xl" />
      <div className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[900px] rounded-full bg-emerald-300/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1560px] px-6 py-10">
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
                    <SideLink href="/" active label="Products" />
                    <SideLink href="/reorder" label="Reorder List" />
                  </div>

                  <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="text-xs text-white/60">Connection</div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm text-white font-medium">Synced</div>
                      <span className="text-xs px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-100 border border-emerald-400/20">
                        Live
                      </span>
                    </div>
                    <div className="mt-2 text-xs text-white/45 font-mono break-all">{API}</div>
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

                  <button
                    onClick={() => {
                      clearAuth();
                      router.replace("/login");
                    }}
                    className="mt-3 w-full rounded-xl px-3 py-2 text-xs font-semibold bg-white/5 text-white/80 hover:bg-white/10 transition"
                    title="Logout"
                  >
                    Logout
                  </button>
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
                      <div className="text-sm text-zinc-500">Inventory</div>
                      <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">What needs attention?</h1>
                      <div className="mt-2 text-sm text-zinc-500 max-w-[920px] leading-relaxed">
                        <span className="font-medium text-zinc-700">Out</span> = zero stock.{" "}
                        <span className="font-medium text-zinc-700">Low</span> = you’re at/under your reorder point
                        (your safe minimum while waiting for delivery).
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
                        disabled={!canWrite}
                        onClick={openAddModal}
                        className={[
                          "rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition",
                          canWrite
                            ? "bg-emerald-600 text-white hover:bg-emerald-700"
                            : "bg-zinc-300 text-zinc-600 cursor-not-allowed",
                        ].join(" ")}
                        title={canWrite ? "Add product" : "Viewer is read-only"}
                      >
                        + Add product
                      </button>

                      <Link
                        href="/reorder"
                        className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 transition"
                      >
                        Reorder List
                      </Link>
                    </div>
                  </div>

                  {attentionBannerCount > 0 && (
                    <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="text-sm text-rose-800">
                        <span className="font-semibold">{attentionBannerCount}</span> items need attention. Want the
                        recommended buy list?
                      </div>
                      <Link
                        href="/reorder"
                        className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 transition"
                      >
                        View Reorder List
                      </Link>
                    </div>
                  )}
                </div>

                <div className="p-8 space-y-6">
                  {/* KPI cards */}
                  <section className="grid grid-cols-12 gap-4">
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Attention"
                      value={(stats.out + stats.low).toString()}
                      hint="Out + Low"
                      tone="danger"
                      active={tableFilter === "ATTENTION"}
                      onClick={() => setTableFilter("ATTENTION")}
                    />
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Out"
                      value={stats.out}
                      hint="Stock is 0"
                      tone="danger"
                      active={tableFilter === "OUT"}
                      onClick={() => setTableFilter("OUT")}
                    />
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Low"
                      value={stats.low}
                      hint="At/below reorder point"
                      tone="danger"
                      active={tableFilter === "LOW"}
                      onClick={() => setTableFilter("LOW")}
                    />
                    <MetricButton
                      className="col-span-12 md:col-span-3"
                      label="Good"
                      value={stats.good}
                      hint="Healthy stock"
                      tone="good"
                      active={tableFilter === "GOOD"}
                      onClick={() => setTableFilter("GOOD")}
                    />
                  </section>

                  {/* Search + Filters */}
                  <section className="rounded-2xl bg-white border border-emerald-100 shadow-[0_12px_34px_rgba(0,0,0,0.06)] p-6">
                    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:justify-between">
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
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
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
                            className="mt-2 w-full sm:w-[240px] rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                          >
                            <option value="ATTENTION">Attention first</option>
                            <option value="SKU">SKU (A → Z)</option>
                            <option value="QTY_ASC">Qty (low → high)</option>
                            <option value="QTY_DESC">Qty (high → low)</option>
                          </select>
                        </div>

                        <div className="flex items-end">
                          <button
                            onClick={() => {
                              setSearch("");
                              setCategoryFilter("ALL");
                              setTableFilter("ATTENTION");
                              setSortMode("ATTENTION");
                            }}
                            className="w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-semibold bg-white border border-zinc-200 hover:shadow transition"
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Table */}
                  <section className="rounded-2xl bg-white border border-emerald-100 shadow-[0_12px_34px_rgba(0,0,0,0.06)] overflow-hidden">
                    <div className="px-6 py-5 border-b border-emerald-100">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                          <div className="text-xs font-medium text-zinc-500">Inventory list</div>
                          <div className="text-lg font-semibold text-zinc-900 mt-1">Products</div>
                          <div className="mt-1 text-xs text-zinc-500">Tip: Use the stepper to adjust stock (Undo works).</div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="text-xs text-zinc-500">Step</span>
                          <select
                            value={stepSize}
                            onChange={(e) => setStepSize(Number(e.target.value))}
                            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/15"
                          >
                            <option value={1}>1</option>
                            <option value={5}>5</option>
                            <option value={10}>10</option>
                          </select>

                          <button
                            onClick={() => setTableFilter("ALL")}
                            className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow transition"
                          >
                            Show all
                          </button>
                        </div>
                      </div>
                    </div>

                    {loading ? (
                      <div className="p-6">
                        <TableSkeleton rows={8} />
                      </div>
                    ) : items.length === 0 ? (
                      <EmptyState onAdd={openAddModal} />
                    ) : shownItems.length === 0 ? (
                      <NoMatchesState
                        onReset={() => {
                          setSearch("");
                          setCategoryFilter("ALL");
                          setTableFilter("ATTENTION");
                          setSortMode("ATTENTION");
                        }}
                      />
                    ) : (
                      <div className="w-full overflow-x-auto">
                        <table className="min-w-[1520px] w-full text-sm table-auto">
                          <thead className="bg-gradient-to-r from-emerald-50 to-white text-zinc-600">
                            <tr className="border-b border-emerald-100">
                              <th className="text-left font-medium px-4 py-4 w-[120px]">SKU</th>
                              <th className="text-left font-medium px-4 py-4">Name</th>
                              <th className="text-left font-medium px-4 py-4 w-[170px]">Category</th>
                              <th className="text-left font-medium px-4 py-4 w-[170px]">Supplier</th>

                              <th className="text-right font-medium px-4 py-4 w-[170px]">On hand</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Lead time</th>
                              <th className="text-right font-medium px-4 py-4 w-[140px]">Demand/day</th>
                              <th className="text-right font-medium px-4 py-4 w-[110px]">Safety</th>

                              <th className="text-right font-medium px-4 py-4 w-[110px]">ROP</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Below by</th>
                              <th className="text-right font-medium px-4 py-4 w-[120px]">Status</th>
                              <th className="text-right font-medium px-3 py-4 w-[260px]">Actions</th>
                            </tr>
                          </thead>

                          <tbody>
                            {shownItems.map((p) => {
                              const s = getUIStatus(p);
                              const isEditing = editingId === p.id;
                              const busy = rowBusyId === p.id;
                              const qtyBusy = qtyBusyId === p.id;

                              const actionDisabled = busy || qtyBusy;
                              const rop = getReorderPoint(p);
                              const deficit = Math.max(0, rop - (p.quantity ?? 0));

                              const rowEmphasis = s === "OUT" ? "bg-rose-50/60" : s === "LOW" ? "bg-amber-50/60" : "";

                              return (
                                <tr
                                  key={p.id}
                                  className={[
                                    "border-b border-emerald-50 hover:bg-emerald-50/40 transition",
                                    rowEmphasis,
                                  ].join(" ")}
                                >
                                  <td className="px-4 py-4 font-mono text-zinc-900">{p.sku}</td>

                                  <td className="px-4 py-4 text-zinc-900 font-medium">
                                    {isEditing ? (
                                      <LightInput
                                        value={editDraft.name}
                                        onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                                        className="py-2"
                                      />
                                    ) : (
                                      <div className="truncate">{p.name}</div>
                                    )}
                                  </td>

                                  <td className="px-4 py-4 text-zinc-700">
                                    {isEditing ? (
                                      <LightInput
                                        value={editDraft.category}
                                        placeholder="(optional)"
                                        onChange={(e) => setEditDraft((d) => ({ ...d, category: e.target.value }))}
                                        className="py-2"
                                      />
                                    ) : (
                                      <div className="truncate">{p.category ?? "Uncategorized"}</div>
                                    )}
                                  </td>

                                  <td className="px-4 py-4 text-zinc-700">
                                    {isEditing ? (
                                      <LightInput
                                        value={editDraft.supplier}
                                        placeholder="(optional)"
                                        onChange={(e) => setEditDraft((d) => ({ ...d, supplier: e.target.value }))}
                                        className="py-2"
                                      />
                                    ) : (
                                      <div className="truncate">{p.supplier ?? "—"}</div>
                                    )}
                                  </td>

                                  {/* On hand stepper */}
                                  <td className="px-4 py-4 text-right">
                                    <div className="inline-flex items-center justify-end gap-2">
                                      <button
                                        disabled={qtyBusy || !canWrite}
                                        onClick={() => adjustQty(p, -stepSize)}
                                        className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                                        aria-label="Decrease stock"
                                        title={!canWrite ? "Viewer is read-only" : "Decrease stock"}
                                      >
                                        –
                                      </button>

                                      <div className="h-9 min-w-[52px] inline-flex items-center justify-center text-zinc-900 font-semibold tabular-nums">
                                        {p.quantity}
                                      </div>

                                      <button
                                        disabled={qtyBusy || !canWrite}
                                        onClick={() => adjustQty(p, +stepSize)}
                                        className="h-9 w-9 inline-flex items-center justify-center rounded-lg bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
                                        aria-label="Increase stock"
                                        title={!canWrite ? "Viewer is read-only" : "Increase stock"}
                                      >
                                        +
                                      </button>
                                    </div>
                                  </td>

                                  {/* Lead time */}
                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {isEditing ? (
                                      <LightInput
                                        type="number"
                                        min={0}
                                        step={1}
                                        inputMode="numeric"
                                        value={editDraft.lead_time_days}
                                        onChange={(e) =>
                                          setEditDraft((d) => ({ ...d, lead_time_days: Number(e.target.value) }))
                                        }
                                        className="px-3 py-2 text-right"
                                      />
                                    ) : (
                                      `${Number(p.lead_time_days ?? 0) || 0}d`
                                    )}
                                  </td>

                                  {/* Demand/day */}
                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {isEditing ? (
                                      <LightInput
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        inputMode="decimal"
                                        value={editDraft.avg_daily_demand}
                                        onChange={(e) =>
                                          setEditDraft((d) => ({ ...d, avg_daily_demand: Number(e.target.value) }))
                                        }
                                        className="px-3 py-2 text-right"
                                      />
                                    ) : (
                                      (Number(p.avg_daily_demand ?? 0) || 0).toFixed(2)
                                    )}
                                  </td>

                                  {/* Safety */}
                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {isEditing ? (
                                      <LightInput
                                        type="number"
                                        min={0}
                                        step={1}
                                        inputMode="numeric"
                                        value={editDraft.safety_stock}
                                        onChange={(e) =>
                                          setEditDraft((d) => ({ ...d, safety_stock: Number(e.target.value) }))
                                        }
                                        className="px-3 py-2 text-right"
                                      />
                                    ) : (
                                      Number(p.safety_stock ?? 0) || 0
                                    )}
                                  </td>

                                  {/* ROP */}
                                  <td className="px-4 py-4 text-right text-zinc-900 font-semibold tabular-nums">
                                    {isEditing ? calcROP(editDraft) : rop}
                                  </td>

                                  {/* Below by */}
                                  <td className="px-4 py-4 text-right text-zinc-700 tabular-nums">
                                    {deficit === 0 ? "—" : deficit}
                                  </td>

                                  {/* Status */}
                                  <td className="px-4 py-4 text-right">
                                    <StatusPill status={s} />
                                  </td>

                                  {/* Actions */}
                                  <td className="px-3 py-4 text-right">
                                    {isEditing ? (
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          disabled={busy}
                                          onClick={() => saveEdit(p)}
                                          className="rounded-lg px-2.5 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
                                        >
                                          Save
                                        </button>
                                        <button
                                          disabled={busy}
                                          onClick={cancelEdit}
                                          className="rounded-lg px-2.5 py-2 text-xs font-medium bg-white border border-zinc-200 hover:shadow disabled:opacity-60"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex flex-wrap justify-end gap-2">
                                        <button
                                          disabled={actionDisabled}
                                          onClick={() => openHistory(p)}
                                          className="rounded-lg px-2.5 py-2 text-xs font-medium bg-white border border-zinc-200 hover:shadow disabled:opacity-60"
                                          title="View stock history"
                                        >
                                          History
                                        </button>

                                        {s !== "GOOD" && (
                                          <Link
                                            href="/reorder"
                                            className={[
                                              "rounded-lg px-2.5 py-2 text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700",
                                              actionDisabled ? "pointer-events-none opacity-60" : "",
                                            ].join(" ")}
                                            title="Go to reorder list"
                                          >
                                            Reorder
                                          </Link>
                                        )}
                                        <button
                                          disabled={actionDisabled || !canWrite}
                                          onClick={() => startEdit(p)}
                                          className="rounded-lg px-2.5 py-2 text-xs font-medium bg-white border border-zinc-200 hover:shadow disabled:opacity-60"
                                          title={!canWrite ? "Viewer is read-only" : "Edit"}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          disabled={actionDisabled || !canWrite}
                                          onClick={() => requestDelete(p)}
                                          className="rounded-lg px-2.5 py-2 text-xs font-medium bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                                          title={!canWrite ? "Viewer is read-only" : "Delete"}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
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
              <div className="mt-2 text-sm text-zinc-600">This page uses your JWT token. Role controls what you can edit.</div>
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

      {/* History modal */}
      {historyOpen && historyProduct && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={closeHistory} />
          <div className="relative w-full max-w-3xl rounded-2xl bg-white border border-zinc-200 shadow-[0_30px_90px_rgba(0,0,0,0.28)] overflow-hidden">
            <div className="px-6 py-5 border-b border-zinc-200 flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-500">History</div>
                <div className="text-lg font-semibold text-zinc-900 mt-1 truncate">
                  {historyProduct.sku} — {historyProduct.name}
                </div>
                <div className="mt-2 text-sm text-zinc-600">Shows who changed stock and when.</div>
              </div>
              <button
                onClick={closeHistory}
                className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6">
              {historyLoading ? (
                <div className="text-sm text-zinc-500">Loading history…</div>
              ) : historyErr ? (
                <div className="text-sm text-rose-700">Error: {historyErr}</div>
              ) : historyLogs.length === 0 ? (
                <div className="text-sm text-zinc-600">No history yet for this product.</div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <table className="min-w-[820px] w-full text-sm table-auto">
                    <thead className="bg-zinc-50 text-zinc-600">
                      <tr className="border-b border-zinc-200">
                        <th className="text-left font-medium px-3 py-3 w-[160px]">When</th>
                        <th className="text-left font-medium px-3 py-3 w-[160px]">Who</th>
                        <th className="text-left font-medium px-3 py-3 w-[160px]">Action</th>
                        <th className="text-right font-medium px-3 py-3 w-[120px]">Prev</th>
                        <th className="text-right font-medium px-3 py-3 w-[120px]">New</th>
                        <th className="text-right font-medium px-3 py-3 w-[120px]">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyLogs.map((log) => (
                        <tr key={log.id} className="border-b border-zinc-100">
                          <td className="px-3 py-3 text-zinc-700">{fmtWhen(log.created_at)}</td>
                          <td className="px-3 py-3 text-zinc-900 font-medium">{log.actor || "system"}</td>
                          <td className="px-3 py-3 text-zinc-700">{prettyAction(log.action)}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-700">{log.prev_quantity}</td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-900 font-semibold">{log.new_quantity}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <span
                              className={[
                                "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border",
                                log.delta < 0
                                  ? "bg-rose-50 text-rose-700 border-rose-200"
                                  : log.delta > 0
                                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                  : "bg-zinc-50 text-zinc-700 border-zinc-200",
                              ].join(" ")}
                            >
                              {log.delta > 0 ? `+${log.delta}` : `${log.delta}`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="px-6 py-5 border-t border-zinc-200 flex items-center justify-between gap-3">
              <div className="text-xs text-zinc-500">
                Tip: your name is sent as <span className="font-mono">X-Actor</span> header.
              </div>
              <button
                onClick={() => historyProduct && openHistory(historyProduct)}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition"
              >
                Refresh history
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product modal */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={closeAddModal} />
          <div className="relative w-full max-w-2xl rounded-2xl bg-white border border-emerald-100 shadow-[0_30px_90px_rgba(0,0,0,0.28)] overflow-hidden">
            <div className="px-6 py-5 border-b border-emerald-100 flex items-start justify-between gap-6">
              <div>
                <div className="text-xs font-medium text-zinc-500">Create</div>
                <div className="text-lg font-semibold text-zinc-900 mt-1">Add Product</div>
                <div className="mt-2 text-sm text-zinc-600">
                  Reorder point is your <span className="font-medium">safe minimum</span> while waiting for delivery.
                </div>
              </div>

              <button
                onClick={closeAddModal}
                className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
              >
                Close
              </button>
            </div>

            <div className="px-6 py-6">
              <div className="grid grid-cols-12 gap-3 items-start">
                <Field className="col-span-12 md:col-span-4" label="SKU">
                  <LightInput
                    inputRef={skuInputRef}
                    placeholder="SKU-003"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProduct();
                    }}
                  />
                </Field>

                <Field className="col-span-12 md:col-span-8" label="Name">
                  <LightInput
                    placeholder="e.g. Widget A"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProduct();
                    }}
                  />
                </Field>

                <Field className="col-span-12 md:col-span-6" label="Category (optional)">
                  <LightInput
                    placeholder="e.g. Widgets"
                    value={form.category ?? ""}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProduct();
                    }}
                  />
                </Field>

                <Field className="col-span-12 md:col-span-6" label="Supplier (optional)">
                  <LightInput
                    placeholder="e.g. ACME Co."
                    value={form.supplier ?? ""}
                    onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProduct();
                    }}
                  />
                </Field>

                <Field className="col-span-6 md:col-span-3" label="On hand">
                  <LightInput
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={form.quantity}
                    onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addProduct();
                    }}
                    className="px-3 py-2 text-right"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">Current stock</div>
                </Field>

                <Field className="col-span-6 md:col-span-3" label="Lead time (days)">
                  <LightInput
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={form.lead_time_days}
                    onChange={(e) => setForm({ ...form, lead_time_days: Number(e.target.value) })}
                    className="px-3 py-2 text-right"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">Days to arrive</div>
                </Field>

                <Field className="col-span-6 md:col-span-3" label="Demand/day">
                  <LightInput
                    type="number"
                    min={0}
                    step={0.1}
                    inputMode="decimal"
                    value={form.avg_daily_demand}
                    onChange={(e) => setForm({ ...form, avg_daily_demand: Number(e.target.value) })}
                    className="px-3 py-2 text-right"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">Avg used per day</div>
                </Field>

                <Field className="col-span-6 md:col-span-3" label="Safety stock">
                  <LightInput
                    type="number"
                    min={0}
                    step={1}
                    inputMode="numeric"
                    value={form.safety_stock}
                    onChange={(e) => setForm({ ...form, safety_stock: Number(e.target.value) })}
                    className="px-3 py-2 text-right"
                  />
                  <div className="mt-1 text-[11px] text-zinc-500">Extra buffer</div>
                </Field>

                <div className="col-span-12">
                  <div className="mt-1 rounded-2xl border border-emerald-100 bg-emerald-50/40 px-4 py-3 text-sm text-zinc-700">
                    Reorder point (auto):{" "}
                    <span className="font-semibold text-zinc-900 tabular-nums">{calcROP(form)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 py-5 border-t border-emerald-100 flex justify-end gap-2">
              <button
                onClick={closeAddModal}
                className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
              >
                Cancel
              </button>
              <button
                onClick={addProduct}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
              >
                Add product
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/50" onClick={() => (!deleteBusy ? setDeleteTarget(null) : null)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white border border-emerald-100 shadow-[0_30px_80px_rgba(0,0,0,0.25)] overflow-hidden">
            <div className="px-6 py-5 border-b border-emerald-100">
              <div className="text-xs font-medium text-zinc-500">Confirm</div>
              <div className="text-lg font-semibold text-zinc-900 mt-1">Delete product?</div>
            </div>

            <div className="px-6 py-5 text-sm text-zinc-700">
              You’re about to delete:
              <div className="mt-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="font-mono text-zinc-900">{deleteTarget.sku}</div>
                <div className="text-zinc-700">{deleteTarget.name}</div>
              </div>
              <div className="mt-3 text-xs text-zinc-500">This will remove it from your active list.</div>
            </div>

            <div className="px-6 py-5 border-t border-emerald-100 flex justify-end gap-2">
              <button
                disabled={deleteBusy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                disabled={deleteBusy}
                onClick={confirmDelete}
                className="rounded-xl px-4 py-2 text-sm font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60"
              >
                {deleteBusy ? "Deleting..." : "Delete"}
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

            <div className="flex items-center gap-2">
              {toast.undo && (
                <button
                  onClick={() => {
                    const fn = toast.undo;
                    setToast(null);
                    fn?.();
                  }}
                  className="rounded-xl px-3 py-2 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800"
                >
                  Undo
                </button>
              )}
              <button
                onClick={() => setToast(null)}
                className="rounded-xl px-3 py-2 text-sm font-medium bg-white border border-zinc-200 hover:shadow"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- UI components ---------- */

function SideLink({ href, label, active }: { href: string; label: string; active?: boolean }) {
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

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <div className="h-4 leading-4 text-[11px] font-medium text-zinc-600 mb-1 truncate">{label}</div>
      {children}
    </div>
  );
}

function LightInput({
  className = "",
  inputRef,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  className?: string;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <input
      ref={inputRef}
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

/* ---------- Skeleton + Empty States ---------- */

function SkeletonLine({ className = "" }: { className?: string }) {
  return <div className={["h-3 rounded-full bg-zinc-200/70 animate-pulse", className].join(" ")} />;
}

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-[1520px] w-full text-sm table-auto">
        <thead className="bg-gradient-to-r from-emerald-50 to-white text-zinc-600">
          <tr className="border-b border-emerald-100">
            {Array.from({ length: 12 }).map((_, i) => (
              <th key={i} className="text-left font-medium px-4 py-4">
                <SkeletonLine className="w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-emerald-50">
              {Array.from({ length: 12 }).map((_, c) => (
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

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="p-10">
      <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-8">
        <div className="text-lg font-semibold text-zinc-900">No products yet</div>
        <div className="mt-2 text-sm text-zinc-600 max-w-[720px]">
          Add your first product to start tracking stock. You can always edit supplier, lead time, demand, and safety
          stock later.
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            onClick={onAdd}
            className="rounded-xl px-4 py-2 text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            + Add product
          </button>
        </div>
      </div>
    </div>
  );
}

function NoMatchesState({ onReset }: { onReset: () => void }) {
  return (
    <div className="p-10">
      <div className="rounded-2xl border border-zinc-200 bg-white p-8">
        <div className="text-lg font-semibold text-zinc-900">No matches</div>
        <div className="mt-2 text-sm text-zinc-600">Try adjusting your search, category, or filters.</div>
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
