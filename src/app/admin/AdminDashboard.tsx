"use client";

import { useCallback, useEffect, useState } from "react";
import type { AdminStats } from "@/lib/admin";

const EMPTY_STATS: AdminStats = {
  users: 0,
  proSubscribers: 0,
  totalBreaks: 0,
  estimatedSpend: 0,
  savedStations: 0,
};

type MetricCard = {
  label: string;
  value: string;
  hint: string;
};

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

function formatUpdatedAt(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats>(EMPTY_STATS);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/stats", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      const data = (await res.json()) as AdminStats;
      setStats(data);
      setUpdatedAt(new Date().toISOString());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const cards: MetricCard[] = [
    {
      label: "Total Accounts Registered",
      value: formatCount(stats.users),
      hint: "Clerk-backed rows in users",
    },
    {
      label: "Active Pro Subscribers",
      value: formatCount(stats.proSubscribers),
      hint: "users.tier = pro",
    },
    {
      label: "Monthly DJ Breaks Served",
      value: formatCount(stats.totalBreaks),
      hint: "Sum of breakCount across meters",
    },
    {
      label: "Estimated API Spend ($)",
      value: formatUsd(stats.estimatedSpend),
      hint: "$0.0039 per voiced break",
    },
    {
      label: "Total Stations Created",
      value: formatCount(stats.savedStations),
      hint: "Rows in user_saved_stations",
    },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(41,146,207,0.12),_transparent_55%)]" />
      <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-10 flex flex-col gap-4 border-b border-white/[0.08] pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
              Internal · Restricted
            </p>
            <h1 className="mt-2 font-sans text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              SongHost Studio Ops & Analytics
            </h1>
            <p className="mt-2 max-w-xl text-sm text-zinc-400">
              Platform health for accounts, Pro conversion, DJ break volume, and
              estimated speech API spend.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => void loadStats()}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-lg bg-accent px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-widest text-zinc-950 transition-colors hover:bg-accent-hover active:scale-[0.98] disabled:cursor-wait disabled:opacity-70"
            >
              {loading ? "Refreshing…" : "Refresh Stats"}
            </button>
            <p className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              Last updated · {formatUpdatedAt(updatedAt)}
            </p>
          </div>
        </header>

        {error ? (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-500/30 bg-red-950/40 px-4 py-3 text-sm text-red-200"
          >
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <article
              key={card.label}
              className="rounded-2xl border border-white/[0.08] bg-surface/80 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-sm"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                {card.label}
              </p>
              <p className="mt-3 font-mono text-3xl font-bold tracking-tight text-zinc-50 tabular-nums">
                {loading && !updatedAt ? "—" : card.value}
              </p>
              <p className="mt-2 text-xs text-zinc-500">{card.hint}</p>
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
