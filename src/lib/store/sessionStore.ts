"use client";

import { useSyncExternalStore } from "react";

/**
 * Model 3 Host Retention Engine — host lock + active host id.
 *
 * When unlocked (`isHostLocked === false`) and no persisted host id is present,
 * station launches auto-match the curated default host. When locked — or when a
 * saved `activeHostId` is restored from localStorage — the listener's host is
 * preserved across channel changes and page refreshes until {@link resetHostLock}.
 *
 * Persistence keys (MUST take priority over station defaults on hydrate):
 * - `songhost_active_host_id`
 * - `songhost_is_host_locked`
 */

export const ACTIVE_HOST_ID_STORAGE_KEY = "songhost_active_host_id";
export const HOST_LOCKED_STORAGE_KEY = "songhost_is_host_locked";

export type SessionState = {
  isHostLocked: boolean;
  /** Listener-selected / restored DJ persona id (e.g. `"jasper-reed"`). */
  activeHostId: string | null;
};

type Listener = () => void;

const SERVER_SNAPSHOT: SessionState = Object.freeze({
  isHostLocked: false,
  activeHostId: null,
});

let state: SessionState = {
  isHostLocked: false,
  activeHostId: null,
};

let didHydrate = false;
/** When true, persist skips the cloud-sync listener (remote hydrate path). */
let suppressHostRetentionSync = false;

const listeners = new Set<Listener>();
const hostRetentionSyncListeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(partial: Partial<SessionState>): void {
  state = { ...state, ...partial };
  emit();
}

function canUseStorage(): boolean {
  return typeof window !== "undefined";
}

function persistToLocalStorage(next: SessionState): void {
  if (!canUseStorage()) return;
  try {
    if (next.activeHostId) {
      window.localStorage.setItem(ACTIVE_HOST_ID_STORAGE_KEY, next.activeHostId);
    } else {
      window.localStorage.removeItem(ACTIVE_HOST_ID_STORAGE_KEY);
    }
    window.localStorage.setItem(
      HOST_LOCKED_STORAGE_KEY,
      next.isHostLocked ? "true" : "false",
    );
  } catch {
    // Quota / private mode — keep in-memory state only.
  }
  if (!suppressHostRetentionSync) {
    for (const listener of hostRetentionSyncListeners) listener();
  }
}

/**
 * Subscribe to Host Retention persist events (lock / unlock / host id stamp).
 * Used by `UserPreferencesContext` to debounce a cloud `preferences` upsert.
 */
export function subscribeHostRetentionSync(listener: Listener): () => void {
  hostRetentionSyncListeners.add(listener);
  return () => {
    hostRetentionSyncListeners.delete(listener);
  };
}

/**
 * Apply a cloud `hostRetention` snapshot onto `songhost_active_host_id` /
 * `songhost_is_host_locked`. Does not echo back to `/api/user/sync`.
 */
export function applyHostRetentionFromCloud(retention: {
  activeHostId: string | null;
  isHostLocked: boolean;
}): void {
  hydrateSessionStore();
  const trimmed = retention.activeHostId?.trim() || null;
  const next: SessionState = {
    activeHostId: trimmed,
    isHostLocked: retention.isHostLocked === true,
  };
  if (state.activeHostId === next.activeHostId && state.isHostLocked === next.isHostLocked) {
    suppressHostRetentionSync = true;
    try {
      persistToLocalStorage(next);
    } finally {
      suppressHostRetentionSync = false;
    }
    return;
  }
  suppressHostRetentionSync = true;
  try {
    setState(next);
    persistToLocalStorage(state);
  } finally {
    suppressHostRetentionSync = false;
  }
}

/**
 * Read `songhost_active_host_id` / `songhost_is_host_locked` into the store.
 * Safe to call repeatedly; runs once per page load on the client.
 */
export function hydrateSessionStore(): SessionState {
  if (didHydrate || !canUseStorage()) return state;
  didHydrate = true;

  try {
    const savedHostId =
      window.localStorage.getItem(ACTIVE_HOST_ID_STORAGE_KEY)?.trim() || null;
    const savedHostLocked =
      window.localStorage.getItem(HOST_LOCKED_STORAGE_KEY) === "true";

    if (savedHostId) {
      state = {
        activeHostId: savedHostId,
        // Locked flag restores only when explicitly persisted as true — but a
        // valid saved host id alone still blocks station-default overwrites.
        isHostLocked: savedHostLocked,
      };
    } else if (savedHostLocked) {
      state = { ...state, isHostLocked: true };
    }
  } catch {
    // Ignore corrupt / blocked storage; keep defaults.
  }

  return state;
}

/** Subscribe to session store updates (for `useSyncExternalStore`). */
export function subscribeSessionStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionSnapshot(): SessionState {
  hydrateSessionStore();
  return state;
}

/** Server / SSR snapshot — host retention is client-session only. */
export function getServerSessionSnapshot(): SessionState {
  return SERVER_SNAPSHOT;
}

/** @internal vitest — reset the singleton between cases. */
export function __resetSessionStoreForTests(): void {
  didHydrate = false;
  suppressHostRetentionSync = false;
  state = { isHostLocked: false, activeHostId: null };
  listeners.clear();
  hostRetentionSyncListeners.clear();
}

export function getIsHostLocked(): boolean {
  hydrateSessionStore();
  return state.isHostLocked;
}

export function getActiveHostId(): string | null {
  hydrateSessionStore();
  return state.activeHostId;
}

/**
 * True when Host Retention should block applying `station.defaultPersonaId`
 * (locked session and/or a persisted host id from a prior selection).
 */
export function shouldRetainHost(): boolean {
  hydrateSessionStore();
  return state.isHostLocked || Boolean(state.activeHostId);
}

/** Stamp the active host id and persist it immediately. */
export function setActiveHostId(hostId: string): void {
  const next = hostId.trim();
  if (!next) return;
  if (state.activeHostId === next) {
    // Still rewrite storage so an explicit pick always lands in localStorage.
    persistToLocalStorage(state);
    return;
  }
  setState({ activeHostId: next });
  persistToLocalStorage(state);
}

/**
 * Lock the active host across subsequent station / channel changes.
 * When `hostId` is supplied, also stamp + persist `songhost_active_host_id`.
 */
export function lockHost(hostId?: string): void {
  hydrateSessionStore();
  const trimmed = hostId?.trim();
  const nextHostId = trimmed || state.activeHostId;
  const next: SessionState = {
    isHostLocked: true,
    activeHostId: nextHostId,
  };
  if (state.isHostLocked && state.activeHostId === nextHostId) {
    persistToLocalStorage(next);
    return;
  }
  setState(next);
  persistToLocalStorage(state);
}

/**
 * Clear the host lock (and persisted host id) so the next station match can
 * auto-apply the curated default.
 */
export function resetHostLock(): void {
  hydrateSessionStore();
  if (!state.isHostLocked && !state.activeHostId) return;
  setState({ isHostLocked: false, activeHostId: null });
  persistToLocalStorage(state);
}

export type SessionStore = SessionState & {
  lockHost: (hostId?: string) => void;
  resetHostLock: () => void;
  setActiveHostId: (hostId: string) => void;
};

/** React binding for the Host Retention Engine. */
export function useSessionStore(): SessionStore {
  const snapshot = useSyncExternalStore(
    subscribeSessionStore,
    getSessionSnapshot,
    getServerSessionSnapshot,
  );

  return {
    isHostLocked: snapshot.isHostLocked,
    activeHostId: snapshot.activeHostId,
    lockHost,
    resetHostLock,
    setActiveHostId,
  };
}
