"use client";

import { useSyncExternalStore } from "react";

/**
 * Model 3 Host Retention Engine — session-scoped host lock.
 *
 * When unlocked (`isHostLocked === false`), station launches auto-match the
 * curated default host. When locked, the listener's active host is preserved
 * across channel changes until {@link resetHostLock}.
 */

export type SessionState = {
  isHostLocked: boolean;
};

type Listener = () => void;

let state: SessionState = {
  isHostLocked: false,
};

const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener();
}

function setState(partial: Partial<SessionState>): void {
  state = { ...state, ...partial };
  emit();
}

/** Subscribe to session store updates (for `useSyncExternalStore`). */
export function subscribeSessionStore(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSessionSnapshot(): SessionState {
  return state;
}

/** Server / SSR snapshot — host lock is client-session only. */
export function getServerSessionSnapshot(): SessionState {
  return { isHostLocked: false };
}

export function getIsHostLocked(): boolean {
  return state.isHostLocked;
}

/** Lock the active host across subsequent station / channel changes. */
export function lockHost(): void {
  if (state.isHostLocked) return;
  setState({ isHostLocked: true });
}

/** Clear the host lock so the next (or immediate) station match can auto-apply. */
export function resetHostLock(): void {
  if (!state.isHostLocked) return;
  setState({ isHostLocked: false });
}

export type SessionStore = SessionState & {
  lockHost: () => void;
  resetHostLock: () => void;
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
    lockHost,
    resetHostLock,
  };
}
