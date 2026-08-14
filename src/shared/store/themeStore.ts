import { createVersionedPersist } from "@/shared/lib/versionedPersist";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
}

export function applyTheme(mode: ThemeMode) {
  const dark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: "light",
      setMode: (mode) => {
        applyTheme(mode);
        set({ mode });
      },
    }),
    createVersionedPersist<ThemeState, { mode: ThemeMode }>({
      name: "cbt-theme",
      partialize: (s) => ({ mode: s.mode }),
      onRehydrateStorage: (state) => {
        applyTheme(state?.mode ?? "light");
      },
    }),
  ),
);
