import type { DeviceSession, ExportKind } from "@/features/privacy/types";
import { create } from "zustand";

interface PrivacyState {
  devices: DeviceSession[];
  crate: ExportKind[];
  addToCrate: (kind: ExportKind) => void;
  removeFromCrate: (kind: ExportKind) => void;
  clearCrate: () => void;
  revoke: (id: string) => void;
}

const seedDevices: DeviceSession[] = [
  {
    id: "dev_this",
    label: "This browser",
    method: "passkey",
    current: true,
    lastActive: new Date().toISOString(),
    place: "Padang · local profile",
  },
  {
    id: "dev_ipad",
    label: "Clinic iPad",
    method: "passkey",
    current: false,
    lastActive: "2026-08-11T14:20:00.000Z",
    place: "Supervision room",
  },
  {
    id: "dev_shared",
    label: "Shared workstation",
    method: "magic-link",
    current: false,
    lastActive: "2026-08-06T09:12:00.000Z",
    place: "Admin desk",
  },
];

export const usePrivacyStore = create<PrivacyState>((set) => ({
  devices: seedDevices,
  crate: [],
  addToCrate: (kind) =>
    set((s) => (s.crate.includes(kind) ? s : { crate: [...s.crate, kind] })),
  removeFromCrate: (kind) => set((s) => ({ crate: s.crate.filter((k) => k !== kind) })),
  clearCrate: () => set({ crate: [] }),
  revoke: (id) =>
    set((s) => ({
      devices: s.devices.filter((d) => d.id !== id || d.current),
    })),
}));
