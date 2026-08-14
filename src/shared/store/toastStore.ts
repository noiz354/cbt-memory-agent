import { create } from "zustand";
import { uid } from "@/shared/lib/format";

export type ToastTone = "ink" | "teal" | "success" | "danger";

export interface ToastItem {
  id: string;
  title: string;
  detail?: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = uid("toast");
    set((s) => ({ toasts: [...s.toasts.slice(-4), { ...toast, id }] }));
    window.setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(title: string, detail?: string, tone: ToastTone = "ink") {
  useToastStore.getState().push({ title, detail, tone });
}
