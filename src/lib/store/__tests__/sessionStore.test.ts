import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ACTIVE_HOST_ID_STORAGE_KEY,
  HOST_LOCKED_STORAGE_KEY,
  __resetSessionStoreForTests,
  applyHostRetentionFromCloud,
  getActiveHostId,
  getIsHostLocked,
  hydrateSessionStore,
  lockHost,
  resetHostLock,
} from "../sessionStore";

function installStorageStub(): void {
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
}

beforeEach(() => {
  installStorageStub();
  __resetSessionStoreForTests();
});

afterEach(() => {
  __resetSessionStoreForTests();
  delete (globalThis as { window?: unknown }).window;
});

describe("applyHostRetentionFromCloud", () => {
  it("writes songhost_active_host_id and songhost_is_host_locked", () => {
    applyHostRetentionFromCloud({
      activeHostId: "jasper-reed",
      isHostLocked: true,
    });
    expect(getActiveHostId()).toBe("jasper-reed");
    expect(getIsHostLocked()).toBe(true);
    expect(window.localStorage.getItem(ACTIVE_HOST_ID_STORAGE_KEY)).toBe("jasper-reed");
    expect(window.localStorage.getItem(HOST_LOCKED_STORAGE_KEY)).toBe("true");
  });

  it("clears a prior local lock when cloud reports unlocked", () => {
    lockHost("miles");
    applyHostRetentionFromCloud({ activeHostId: null, isHostLocked: false });
    expect(getActiveHostId()).toBeNull();
    expect(getIsHostLocked()).toBe(false);
    expect(window.localStorage.getItem(ACTIVE_HOST_ID_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(HOST_LOCKED_STORAGE_KEY)).toBe("false");
  });
});

describe("hydrateSessionStore", () => {
  it("restores host retention keys written by cloud apply", () => {
    applyHostRetentionFromCloud({
      activeHostId: "devon-pulse",
      isHostLocked: true,
    });
    __resetSessionStoreForTests();
    hydrateSessionStore();
    expect(getActiveHostId()).toBe("devon-pulse");
    expect(getIsHostLocked()).toBe(true);
  });
});

describe("resetHostLock", () => {
  it("clears both the in-memory lock and persisted keys", () => {
    lockHost("jasper-reed");
    resetHostLock();
    expect(getActiveHostId()).toBeNull();
    expect(getIsHostLocked()).toBe(false);
  });
});
