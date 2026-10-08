/**
 * Asks the signed-in preferences context to pull the account DJ snapshot.
 * Song start and station start call this. The context also listens for
 * tab focus. A break that is on the air defers the apply until it ends.
 */

const listeners = new Set<() => void>();

export function requestDjSettingsRefresh(): void {
  for (const listener of listeners) listener();
}

export function subscribeDjSettingsRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
