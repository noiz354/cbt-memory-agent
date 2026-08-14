import { useAuthStore } from "@/features/auth/store/authStore";

const DEVICE_ID_KEY = "cbt-memory-agent-device-id";

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = `device_${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getAuthHeaders(): { token: string; deviceId: string } | null {
  const profile = useAuthStore.getState().profile;
  if (!profile?.id) return null;
  return { token: profile.id, deviceId: getDeviceId() };
}
