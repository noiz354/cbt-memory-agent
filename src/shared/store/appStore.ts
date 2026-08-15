import { track, TELEMETRY_EVENTS } from "@/shared/lib/telemetryEvents";
import { create } from "zustand";

interface AppState {
  sidebarCollapsed: boolean;
  crisisActive: boolean;
  crisisReason: string | null;
  distressHint: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (value: boolean) => void;
  triggerCrisis: (reason: string) => void;
  dismissCrisis: () => void;
  setDistressHint: (value: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  crisisActive: false,
  crisisReason: null,
  distressHint: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  triggerCrisis: (crisisReason) => {
    set({ crisisActive: true, crisisReason });
    track(TELEMETRY_EVENTS.crisisTriggered, { reason: crisisReason });
  },
  dismissCrisis: () => {
    set({ crisisActive: false, crisisReason: null });
    track(TELEMETRY_EVENTS.crisisResolved);
  },
  setDistressHint: (distressHint) => set({ distressHint }),
}));
