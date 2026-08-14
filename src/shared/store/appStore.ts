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
  triggerCrisis: (crisisReason) => set({ crisisActive: true, crisisReason }),
  dismissCrisis: () => set({ crisisActive: false, crisisReason: null }),
  setDistressHint: (distressHint) => set({ distressHint }),
}));
