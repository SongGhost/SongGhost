"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Product subscription tier (uppercase API used by Pro locks / billing UI). */
export type SubscriptionTier = "FREE" | "PRO";

export const FREE_MONTHLY_BREAKS = 30;
export const PRO_MONTHLY_BREAKS = 300;

const STORAGE_TIER = "songghost_subscription_tier";
const STORAGE_BREAKS = "songghost_dj_breaks_month";
const STORAGE_HD_VOICE = "songghost_hd_broadcast_voice";

type BreaksStorage = {
  /** Calendar month key, e.g. `2026-08` */
  monthKey: string;
  used: number;
};

type TierContextValue = {
  tier: SubscriptionTier;
  isPro: boolean;
  isFree: boolean;
  /** DJ breaks consumed in the current calendar month. */
  breaksUsed: number;
  /** Monthly allowance — 30 Free / 300 Pro. */
  breaksLimit: number;
  breaksRemaining: number;
  canUseBreak: boolean;
  setTier: (tier: SubscriptionTier) => void;
  /**
   * Increment the monthly break counter. Returns `false` when the Free/Pro
   * allowance is exhausted (callers should skip the break or prompt upgrade).
   */
  recordBreak: () => boolean;
  /** HD Broadcast Voice Engine preference (Pro-only). */
  hdVoiceEnabled: boolean;
  setHdVoiceEnabled: (enabled: boolean) => void;
  upgradeModalOpen: boolean;
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

function coerceTier(raw: string | null): SubscriptionTier {
  if (raw === "PRO" || raw === "Pro" || raw === "pro") return "PRO";
  return "FREE";
}

function loadTier(): SubscriptionTier {
  if (!isBrowser()) return "FREE";
  return coerceTier(
    sessionStorage.getItem(STORAGE_TIER) ?? localStorage.getItem(STORAGE_TIER),
  );
}

function persistTier(tier: SubscriptionTier): void {
  if (!isBrowser()) return;
  localStorage.setItem(STORAGE_TIER, tier);
  sessionStorage.setItem(STORAGE_TIER, tier);
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
  return tier === "PRO" ? PRO_MONTHLY_BREAKS : FREE_MONTHLY_BREAKS;
}

export function TierProvider({ children }: { children: ReactNode }) {
  const [tier, setTierState] = useState<SubscriptionTier>("FREE");
  const [breaks, setBreaks] = useState<BreaksStorage>({
    monthKey: currentMonthKey(),
    used: 0,
  });
  const [hdVoiceEnabled, setHdVoiceState] = useState(false);
  const [upgradeModalOpen, setUpgradeModalOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setTierState(loadTier());
    setBreaks(loadBreaks());
    setHdVoiceState(loadHdVoice());
    setHydrated(true);
  }, []);

  // Roll the counter when the calendar month flips while the tab stays open.
  useEffect(() => {
    if (!hydrated) return;
    const monthKey = currentMonthKey();
    if (breaks.monthKey === monthKey) return;
    const next = { monthKey, used: 0 };
    setBreaks(next);
    persistBreaks(next);
  }, [hydrated, breaks.monthKey]);

  const setTier = useCallback((next: SubscriptionTier) => {
    setTierState(next);
    persistTier(next);
    if (next === "FREE") {
      setHdVoiceState(false);
      persistHdVoice(false);
    }
  }, []);

  const setHdVoiceEnabled = useCallback(
    (enabled: boolean) => {
      if (tier !== "PRO") {
        setUpgradeModalOpen(true);
        return;
      }
      setHdVoiceState(enabled);
      persistHdVoice(enabled);
    },
    [tier],
  );

  const recordBreak = useCallback((): boolean => {
    const monthKey = currentMonthKey();
    const limit = breaksLimitFor(tier);
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
    return accepted;
  }, [tier]);

  const openUpgradeModal = useCallback(() => setUpgradeModalOpen(true), []);
  const closeUpgradeModal = useCallback(() => setUpgradeModalOpen(false), []);

  const startFreeTrial = useCallback(() => {
    setTier("PRO");
    setUpgradeModalOpen(false);
  }, [setTier]);

  const breaksLimit = breaksLimitFor(tier);
  const breaksUsed =
    breaks.monthKey === currentMonthKey() ? breaks.used : 0;
  const breaksRemaining = Math.max(0, breaksLimit - breaksUsed);

  const value = useMemo<TierContextValue>(
    () => ({
      tier,
      isPro: tier === "PRO",
      isFree: tier === "FREE",
      breaksUsed,
      breaksLimit,
      breaksRemaining,
      canUseBreak: breaksRemaining > 0,
      setTier,
      recordBreak,
      hdVoiceEnabled: tier === "PRO" && hdVoiceEnabled,
      setHdVoiceEnabled,
      upgradeModalOpen,
      openUpgradeModal,
      closeUpgradeModal,
      startFreeTrial,
    }),
    [
      tier,
      breaksUsed,
      breaksLimit,
      breaksRemaining,
      setTier,
      recordBreak,
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
