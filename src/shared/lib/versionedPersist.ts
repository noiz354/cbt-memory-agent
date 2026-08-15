import type { PersistOptions } from "zustand/middleware";
import { toast } from "@/shared/store/toastStore";

export const STORE_VERSION = 1;

interface VersionedWrapper<T> {
  version: number;
  data: T;
}

/**
 * Wraps a Zustand `persist` config with versioning + migration.
 *
 * - On first write: stores `{ version: STORE_VERSION, data: partializedState }`
 * - On rehydrate: checks version → if mismatch, runs migration or resets
 * - Migration function receives old data and must return new data shape
 */
export function createVersionedPersist<State, PersistedSlice>(opts: {
  name: string;
  partialize: (state: State) => PersistedSlice;
  /** Optional migration: (oldData, fromVersion) → newStateCompatibleWithPersistedSlice */
  migrate?: (oldData: unknown, fromVersion: number) => PersistedSlice;
  /** Optional onRehydrateStorage callback (runs after version check + migration) */
  onRehydrateStorage?: (state: State | undefined) => void;
}): PersistOptions<State, VersionedWrapper<PersistedSlice>> {
  const { name, partialize, migrate, onRehydrateStorage } = opts;

  return {
    name,
    partialize: (state) => ({
      version: STORE_VERSION,
      data: partialize(state),
    }),
    // CRITICAL FIX: Zustand persist default merge is `{ ...currentState, ...persistedState }`,
    // which only merges the top-level wrapper keys {version, data} — the real slice
    // (status/profile/step, nodes, sessions, ...) lives inside `data` and was never
    // unpacked, so nothing ever restored from storage (e.g. auth always rehydrated as
    // 'anonymous' after reload). This merge unpacks `persisted.data` into the store.
    merge: (persistedState, currentState) => {
      if (!persistedState) return currentState;
      const wrapped = persistedState as { version?: number; data?: PersistedSlice };
      const slice = wrapped && "data" in wrapped ? wrapped.data : (persistedState as unknown as PersistedSlice);
      return { ...currentState, ...(slice as Partial<State>) };
    },
    onRehydrateStorage: () => (restored) => {
      const wrapped = restored as { version?: number; data?: PersistedSlice } | undefined;

      if (!wrapped || typeof wrapped.version !== "number") {
        // No version field → either brand new or legacy unversioned data
        if (wrapped && wrapped.data !== undefined) {
          // Legacy data without version — try migrate if available, otherwise accept as-is
          if (migrate) {
            try {
              const migrated = migrate(wrapped.data, 0);
              // Re-persist with current version
              localStorage.setItem(
                name,
                JSON.stringify({ version: STORE_VERSION, data: migrated }),
              );
            } catch {
              localStorage.removeItem(name);
              toast("Vault schema upgraded locally", `${name} was reset to defaults.`, "danger");
            }
          }
          // If no migrate, accept legacy data as-is (will be wrapped on next save)
        }
      } else if (wrapped.version !== STORE_VERSION) {
        // Version mismatch — run migration or reset
        if (migrate) {
          try {
            const migrated = migrate(wrapped.data, wrapped.version);
            localStorage.setItem(
              name,
              JSON.stringify({ version: STORE_VERSION, data: migrated }),
            );
          } catch {
            localStorage.removeItem(name);
            toast("Vault schema upgraded locally", `${name} was reset to defaults.`, "danger");
          }
        } else {
          localStorage.removeItem(name);
          toast("Vault schema upgraded locally", `${name} was reset to defaults.`, "danger");
        }
      }

      onRehydrateStorage?.(restored as State | undefined);
    },
  };
}
