// frontend/src/app/login/page.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getToken, setAuth, type AuthUser } from "@/lib/auth";

const API = process.env.NEXT_PUBLIC_API_BASE_URL!;

type LoginResponse = {
  access_token: string;
  token_type?: string;
  user: AuthUser;
};

export default function LoginPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If already logged in, bounce to app page
  useEffect(() => {
    const t = getToken();
    if (t) router.replace("/"); // ✅ Products page is "/"
  }, [router]);

  const canSubmit = useMemo(() => {
    return username.trim().length > 0 && password.length > 0 && !busy;
  }, [username, password, busy]);

  function useDemo(role: "manager" | "viewer") {
    if (role === "manager") {
      setUsername("manager");
      setPassword("manager123");
      return;
    }
    setUsername("viewer");
    setPassword("viewer123");
  }

  async function login() {
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as LoginResponse;

      // HARD validation so we don't silently "log in" without saving anything
      if (!data?.access_token) throw new Error("No access_token returned.");
      if (!data?.user) throw new Error("No user returned.");
      if (!data?.user?.role) throw new Error("User role missing.");
      if (!data?.user?.name) throw new Error("User name missing.");

      // ✅ THIS IS THE IMPORTANT PART: SAVE TOKEN + USER
      setAuth(data.access_token, data.user);

      // Debug (optional) – open DevTools Console and you should see this
      console.log("✅ Logged in. Token saved?", getToken());
      console.log("✅ User saved:", data.user);

      // Go to app
      router.replace("/"); // ✅ Products page is "/"
    } catch (e: any) {
      setErr(e?.message ?? "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-[#06130B]">
      {/* floating logo (TOP LEFT) — keep consistent */}
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

      {/* Background glow to match app */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#081A10] via-[#040705] to-[#020403]" />
      <div className="pointer-events-none absolute -top-64 -left-64 h-[820px] w-[820px] rounded-full bg-emerald-400/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-72 right-[-260px] h-[860px] w-[860px] rounded-full bg-green-500/20 blur-3xl" />
      <div className="pointer-events-none absolute top-24 left-1/2 -translate-x-1/2 h-[420px] w-[900px] rounded-full bg-emerald-300/10 blur-3xl" />

      <div className="relative mx-auto max-w-[1180px] px-6 py-14">
        <div className="grid grid-cols-12 gap-8 items-stretch">
          {/* Left: landing / brand panel */}
          <aside className="col-span-12 lg:col-span-5">
            <div className="h-full rounded-[30px] overflow-hidden border border-white/10 shadow-[0_50px_170px_-95px_rgba(0,0,0,0.9)]">
              <div className="h-full bg-gradient-to-b from-[#0B1B12] via-[#070B09] to-[#050605] p-8 flex flex-col">
                <div className="flex items-center justify-between">
                  <div className="text-white text-xl font-semibold tracking-tight">SupplySense</div>
                  <span className="text-[11px] px-2 py-1 rounded-full bg-emerald-500/15 text-emerald-100 border border-emerald-400/20">
                    v0.5
                  </span>
                </div>

                <div className="mt-6">
                  <div className="text-white text-3xl font-semibold tracking-tight leading-tight">
                    Inventory clarity,
                    <span className="text-emerald-200"> reorder confidence</span>.
                  </div>
                  <div className="mt-3 text-sm text-white/75 leading-relaxed">
                    Track on-hand stock, spot what needs attention, and generate a clean reorder list based on lead time,
                    demand, and safety stock.
                  </div>
                </div>

                <div className="mt-6 grid gap-3">
                  <Feature
                    title="Products dashboard"
                    desc="Search, filter, adjust stock fast (with undo) and keep your list clean."
                  />
                  <Feature
                    title="Smart reorder list"
                    desc="ROP + target stock computed so you know exactly what to order right now."
                  />
                  <Feature
                    title="Roles"
                    desc="Manager can edit; Viewer is read-only. Use the demo accounts below."
                  />
                </div>

                {/* Demo accounts (user-facing) */}
                <div className="mt-7 rounded-2xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-white/60">Demo access</div>
                      <div className="text-sm text-white/90 font-semibold mt-1">Use one of these accounts</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-semibold">Manager</div>
                          <div className="mt-1 text-xs text-white/65">Can add/edit/delete products</div>
                          <div className="mt-2 text-xs text-white/85 font-mono">manager / manager123</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => useDemo("manager")}
                          className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition"
                        >
                          Use
                        </button>
                      </div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-white font-semibold">Viewer</div>
                          <div className="mt-1 text-xs text-white/65">Read-only access</div>
                          <div className="mt-2 text-xs text-white/85 font-mono">viewer / viewer123</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => useDemo("viewer")}
                          className="shrink-0 rounded-xl px-3 py-2 text-xs font-semibold bg-white/10 text-white hover:bg-white/15 border border-white/10 transition"
                        >
                          Use
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 text-[11px] text-white/50">
                    Tip: click <span className="font-semibold text-white/70">Use</span> to auto-fill the form.
                  </div>
                </div>

                <div className="mt-auto pt-6 text-[11px] text-white/40">© SupplySense — Inventory & Reorder demo</div>
              </div>
            </div>
          </aside>

          {/* Right: login card */}
          <main className="col-span-12 lg:col-span-7">
            <div className="h-full rounded-[30px] overflow-hidden border border-white/60 shadow-[0_60px_160px_-90px_rgba(0,0,0,0.9)]">
              <div className="h-full bg-gradient-to-b from-[#FBFEFB] to-[#EEF7EF]">
                <div className="px-8 pt-10 pb-7 border-b border-emerald-100/80">
                  <div className="text-sm text-zinc-500">Welcome</div>
                  <h1 className="text-4xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
                  <div className="mt-2 text-sm text-zinc-500 max-w-[680px] leading-relaxed">
                    Enter your username and password. You’ll be taken to the Products dashboard after signing in.
                  </div>
                  {err && <div className="mt-4 text-sm text-rose-700">Error: {err}</div>}
                </div>

                <div className="p-8 space-y-5">
                  <Field label="Username">
                    <LightInput
                      placeholder="e.g. manager"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") login();
                      }}
                    />
                  </Field>

                  <Field label="Password">
                    <LightInput
                      type="password"
                      placeholder="e.g. manager123"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") login();
                      }}
                    />
                  </Field>

                  <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                    <button
                      disabled={!canSubmit}
                      onClick={login}
                      className={[
                        "rounded-xl px-5 py-3 text-sm font-semibold shadow-sm transition w-full sm:w-auto",
                        canSubmit ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-zinc-200 text-zinc-500",
                      ].join(" ")}
                    >
                      {busy ? "Signing in..." : "Sign in"}
                    </button>

                    <div className="flex gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => useDemo("manager")}
                        className="w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-semibold bg-zinc-900 text-white hover:bg-zinc-800 transition"
                      >
                        Use Manager
                      </button>
                      <button
                        type="button"
                        onClick={() => useDemo("viewer")}
                        className="w-full sm:w-auto rounded-xl px-4 py-3 text-sm font-semibold bg-white border border-zinc-200 hover:shadow transition"
                      >
                        Use Viewer
                      </button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 text-sm text-zinc-700">
                    <span className="font-semibold text-zinc-900">Manager</span> can edit inventory and reorder settings.
                    <br />
                    <span className="font-semibold text-zinc-900">Viewer</span> can only view dashboards and lists.
                  </div>

                  <div className="text-xs text-zinc-500">
                    Having trouble? Make sure the backend is running and your credentials match the demo accounts.
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

/* ---------- small UI helpers (matches your style) ---------- */

function Feature({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-sm text-white font-semibold">{title}</div>
      <div className="mt-1 text-xs text-white/65 leading-relaxed">{desc}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="h-4 leading-4 text-[11px] font-medium text-zinc-600 mb-1 truncate">{label}</div>
      {children}
    </div>
  );
}

function LightInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
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
