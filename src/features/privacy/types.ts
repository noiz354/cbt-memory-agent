export type ExportKind = "chat" | "mood" | "memory";

export interface DeviceSession {
  id: string;
  label: string;
  method: "passkey" | "magic-link";
  current: boolean;
  lastActive: string;
  place: string;
}
