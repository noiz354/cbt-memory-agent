import { uid } from "@/shared/lib/format";
import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AuditEventType =
  | "CONSENT_GIVEN"
  | "CRISIS_ENGAGED"
  | "CRISIS_DISMISSED"
  | "SESSION_FINALIZED"
  | "MEMORY_VERIFIED"
  | "MEMORY_PURGED"
  | "EXPORT_MINTED"
  | "SESSION_REVOKED"
  | "HARD_PURGE"
  | "SIGN_OUT";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  at: string;
  detail: string;
}

interface AuditState {
  events: AuditEvent[];
  log: (type: AuditEventType, detail: string) => void;
  wipe: () => void;
}

export const useAuditStore = create<AuditState>()(
  persist(
    (set) => ({
      events: [],
      log: (type, detail) =>
        set((s) => ({
          events: [
            { id: uid("evt"), type, at: new Date().toISOString(), detail },
            ...s.events,
          ].slice(0, 80),
        })),
      wipe: () => set({ events: [] }),
    }),
    createVersionedPersist<AuditState, { events: AuditEvent[] }>({
      name: "cbt-audit-log",
      partialize: (s) => ({ events: s.events }),
    }),
  ),
);
