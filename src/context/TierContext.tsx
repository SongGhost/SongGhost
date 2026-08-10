"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { FREE_MONTHLY_BREAK_LIMIT } from "@/lib/usage/constants";

/** Product subscription tier (lowercase API used by billing + voice gates). */
export type SubscriptionTier = "free" | "pro";

export const FREE_MONTHLY_BREAKS = FREE_MONTHLY_BREAK_LIMIT;
/** @deprecated Pro breaks are unlimited — kept for legacy callers. */
export const PRO_MONTHLY_BREAKS = Number.POSITIVE_INFINITY;

/** Dev / testing override — also written by {@link DevTierToggle}. */
export const STORAGE_DEV_TIER = "songhost_dev_tier";
/** Legacy key kept for one-release migration. */
const STORAGE_TIER_LEGACY = "songghost_subscription_tier";
const STORAGE_BREAKS = "songghost_dj_breaks_month";
const STORAGE_HD_VOICE = "songghost_hd_broadcast_voice";

type BreaksStorage = {
  /** Calendar month key, e.g. `2026-08` — used only for guest/local fallback. */
  monthKey: string;
  used: number;
};

type TierContextValue = {
  tier: SubscriptionTier;
  isPro: boolean;
  isFree: boolean;
  /** DJ breaks consumed in the current metering window. */
  breaksUsed: number;
  /**
   * Monthly allowance — 30 Free / `Infinity` Pro (unlimited).
   * Prefer {@link TierContextValue.isPro} + UI copy for "UNLIMITED".
   */
  breaksLimit: number;
  breaksRemaining: number;
  /** Days until the rolling 30-day Free meter resets (`null` when Pro / unknown). */
  daysUntilReset: number | null;
  canUseBreak: boolean;
  setTier: (tier: SubscriptionTier) => void;
  /**
   * Increment the monthly break counter. Returns `false` when the Free
   * allowance is exhausted (callers should skip the break or prompt upgrade).
   * Pro always accepts. Server-side metering in `/api/generate-script` is
   * authoritative for signed-in Free users.
   */
  recordBreak: () => boolean;
  /** Re-fetch `/api/user/usage` for signed-in listeners. */
  refreshUsage: () => Promise<void>;
  /** HD Broadcast Voice Engine preference (Pro-only). */
  hdVoiceEnabled: boolean;
  setHdVoiceEnabled: (enabled: boolean) => void;
  upgradeModalOpen: boolean;
  /** Alias of {@link TierContextValue.upgradeModalOpen}. */
  isUpgradeModalOpen: boolean;
  openUpgradeModal: () => void;
  closeUpgradeModal: () => void;
  /** Activate Pro via the 7-day trial CTA. */
  startFreeTrial: () => void;
};

const TierContext = createContext<TierContextValue | null>(null);

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function currentMonthKey(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}`;
}

export function coerceTier(raw: unknown): SubscriptionTier {
  if (typeof raw !== "string") return "free";
  const normalized = raw.trim().toLowerCase();
  if (normalized === "pro") return "pro";
  return "free";
}

function readDevTier(): SubscriptionTier | null {
  if (!isBrowser()) return null;
  const raw =
    localStorage.getItem(STORAGE_DEV_TIER)
    ?? sessionStorage.getItem(STORAGE_DEV_TIER)
    ?? localStorage.getItem(STORAGE_TIER_LEGACY)
    ?? sessionStorage.getItem(STORAGE_TIER_LEGACY);
  if (raw == null) return null;
  return coerceTier(raw);
}

function persistTier(tier: SubscriptionTier): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_DEV_TIER, tier);
  sessionStorage.setItem(STORAGE_DEV_TIER, tier);
  // Keep legacy key in sync for any older readers.
  localStorage.setItem(STORAGE_TIER_LEGACY, tier === "pro" ? "PRO" : "FREE");
  sessionStorage.setItem(STORAGE_TIER_LEGACY, tier === "pro" ? "PRO" : "FREE");
}

function loadBreaks(): BreaksStorage {
  const monthKey = currentMonthKey();
  if (!isBrowser()) return { monthKey, used: 0 };

  const raw =
    sessionStorage.getItem(STORAGE_BREAKS) ?? localStorage.getItem(STORAGE_BREAKS);
  if (!raw) return { monthKey, used: 0 };

  try {
    const parsed = JSON.parse(raw) as Partial<BreaksStorage>;
    if (parsed.monthKey !== monthKey) return { monthKey, used: 0 };
    const used = typeof parsed.used === "number" && Number.isFinite(parsed.used)
      ? Math.max(0, Math.floor(parsed.used))
      : 0;
    return { monthKey, used };
  } catch {
    return { monthKey, used: 0 };
  }
}

function persistBreaks(value: BreaksStorage): void {
  if (!isBrowser()) return;
  const serialized = JSON.stringify(value);
  localStorage.setItem(STORAGE_BREAKS, serialized);
  sessionStorage.setItem(STORAGE_BREAKS, serialized);
}

function loadHdVoice(): boolean {
  if (!isBrowser()) return false;
  const raw =
    sessionStorage.getItem(STORAGE_HD_VOICE) ??
    localStorage.getItem(STORAGE_HD_VOICE);
  return raw === "1" || raw === "true";
}

function persistHdVoice(enabled: boolean): void {
  if (!isBrowser()) return;
  const next = enabled ? "1" : "0";
  localStorage.setItem(STORAGE_HD_VOICE, next);
  sessionStorage.setItem(STORAGE_HD_VOICE, next);
}

function breaksLimitFor(tier: SubscriptionTier): number {
  return tier === "pro" ? Number.POSITIVE_INFINITY : FREE_MONTHLY_BREAKS;
}

type UsageApiPayload = {
  breakCount?: unknown;
  limit?: unknown;
  daysUntilReset?: unknown;
  tier?: unknown;
};

export function TierProvider({ children }: { children: ReactNode }) {
  const { user, isLoaded: clerkLoaded } = useUser();
  const { isSignedIn } = useAuth();
  const [tier, setTierState] = useState<SubscriptionTier>("free");
  const [breaks, setBreaks] = useState<BreaksStorage>({
    monthKey: currentMonthKey(),
    used: 0,
  });
  const [daysUntilReset, setDaysUntilReset] = useState<number | null>(null);
  const [hdVoiceEnabled, setHdVoiceState] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage first (instant), then reconcile with Clerk metadata.
  useEffect(() => {
    const fromStorage = readDevTier();
    if (fromStorage) setTierState(fromStorage);
    setBreaks(loadBreaks());
    setHdVoiceState(loadHdVoice());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || !clerkLoaded) return;
    // Dev localStorage override wins when present so the floating toggle is sticky.
    const fromStorage = readDevTier();
    if (fromStorage) {
      setTierState(fromStorage);
      return;
    }
    const fromClerk = coerceTier(user?.unsafeMetadata?.tier);
    setTierState(fromClerk);
  }, [hydrated, clerkLoaded, user?.unsafeMetadata?.tier, user?.id]);

  // Roll the local counter when the calendar month flips while the tab stays open
  // (guest / offline fallback only — signed-in users sync from `/api/user/usage`).
  useEffect(() => {
    if (!hydrated || isSignedIn) return;
    const monthKey = currentMonthKey();
    if (breaks.monthKey === monthKey) return;
    const next = { monthKey, used: 0 };
    setBreaks(next);
    persistBreaks(next);
  }, [hydrated, isSignedIn, breaks.monthKey]);

  const refreshUsage = useCallback(async () => {
    if (!isSignedIn) return;
    try {
      const res = await fetch("/api/user/usage", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as UsageApiPayload;
      const used =
        typeof data.breakCount === "number" && Number.isFinite(data.breakCount)
          ? Math.max(0, Math.floor(data.breakCount))
          : 0;
      const monthKey = currentMonthKey();
      const next = { monthKey, used };
      setBreaks(next);
      persistBreaks(next);
      if (
        typeof data.daysUntilReset === "number"
        && Number.isFinite(data.daysUntilReset)
      ) {
        setDaysUntilReset(Math.max(0, Math.floor(data.daysUntilReset)));
      }
      // Prefer server tier when DevTierToggle override is absent.
      if (!readDevTier() && data.tier != null) {
        setTierState(coerceTier(data.tier));
      }
    } catch (err) {
      console.warn("[TierContext] Failed to sync usage from /api/user/usage", err);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (!hydrated || !clerkLoaded || !isSignedIn) {
      if (!isSignedIn) setDaysUntilReset(null);
      return;
    }
    void refreshUsage();
  }, [hydrated, clerkLoaded, isSignedIn, user?.id, tier, refreshUsage]);

  const setTier = useCallback(
    (next: SubscriptionTier) => {
      const resolved = coerceTier(next);
      setTierState(resolved);
      persistTier(resolved);
      if (resolved === "free") {
        setHdVoiceState(false);
        persistHdVoice(false);
      }
      // Clerk deep-merge for unsafeMetadata (v6 `updateMetadata`).
      if (user) {
        void user
          .updateMetadata({ unsafeMetadata: { tier: resolved } })
          .catch((err: unknown) => {
            console.warn("[TierContext] Failed to persist tier to Clerk", err);
          });
      }
    },
    [user],
  );

  const setHdVoiceEnabled = useCallback(
    (enabled: boolean) => {
      if (tier !== "pro") {
        setUpgradeModalOpen(true);
        return;
      }
      setHdVoiceState(enabled);
      persistHdVoice(enabled);
    },
    [tier],
  );

  const recordBreak = useCallback((): boolean => {
    if (tier === "pro") return true;

    const monthKey = currentMonthKey();
    const limit = FREE_MONTHLY_BREAKS;
    let accepted = false;
    setBreaks((prev) => {
      const used = prev.monthKey === monthKey ? prev.used : 0;
      if (used >= limit) {
        accepted = false;
        return prev.monthKey === monthKey ? prev : { monthKey, used: 0 };
      }
      accepted = true;
      const next = { monthKey, used: used + 1 };
      persistBreaks(next);
      return next;
    });
    // Keep signed-in Free meters aligned with the server after optimistic bump.
    if (accepted && isSignedIn) {
      void refreshUsage();
    }
    return accepted;
  }, [tier, isSignedIn, refreshUsage]);

  const openUpgradeModal = useCallback(() => setUpgradeModalOpen(true), []);
  const closeUpgradeModal = useCallback(() => setUpgradeModalOpen(false), []);

  const startFreeTrial = useCallback(() => {
    setTier("pro");
    setUpgradeModalOpen(false);
  }, [setTier]);

  const breaksLimit = breaksLimitFor(tier);
  const breaksUsed =
    breaks.monthKey === currentMonthKey() ? breaks.used : 0;
  const breaksRemaining =
    tier === "pro"
      ? Number.POSITIVE_INFINITY
      : Math.max(0, breaksLimit - breaksUsed);
  const canUseBreak = tier === "pro" || breaksUsed < FREE_MONTHLY_BREAKS;

  const value = useMemo<TierContextValue>(
    () => ({
      tier,
      isPro: tier === "pro",
      isFree: tier === "free",
      breaksUsed,
      breaksLimit,
      breaksRemaining,
      daysUntilReset: tier === "pro" ? null : daysUntilReset,
      canUseBreak,
      setTier,
      recordBreak,
      refreshUsage,
      hdVoiceEnabled: tier === "pro" && hdVoiceEnabled,
      setHdVoiceEnabled,
      upgradeModalOpen,
      isUpgradeModalOpen: upgradeModalOpen,
      openUpgradeModal,
      closeUpgradeModal,
      startFreeTrial,
    }),
    [
      tier,
      breaksUsed,
      breaksLimit,
      breaksRemaining,
      daysUntilReset,
      canUseBreak,
      setTier,
      recordBreak,
      refreshUsage,
      hdVoiceEnabled,
      setHdVoiceEnabled,
      upgradeModalOpen,
      openUpgradeModal,
      closeUpgradeModal,
      startFreeTrial,
    ],
  );

  return <TierContext.Provider value={value}>{children}</TierContext.Provider>;
}

export function useTier(): TierContextValue {
  const ctx = useContext(TierContext);
  if (!ctx) {
    throw new Error("useTier must be used within TierProvider");
  }
  return ctx;
}
