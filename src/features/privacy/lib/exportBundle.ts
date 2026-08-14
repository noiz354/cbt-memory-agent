import { useAuthStore } from "@/features/auth/store/authStore";
import { useChatStore } from "@/features/chat/store/chatStore";
import { useMemoryStore } from "@/features/memory/store/memoryStore";
import type { ExportKind } from "@/features/privacy/types";
import { useSessionStore } from "@/features/sessions/store/sessionStore";
import { useAuditStore } from "@/shared/store/auditStore";
import { apiClient } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";
import { metric } from "@/shared/lib/metrics";

export function buildExportBundle(kinds: ExportKind[]) {
  const profile = useAuthStore.getState().profile;
  const bundle: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    consentVersion: profile?.consentVersion ?? null,
    deviceOnly: true,
  };

  if (kinds.includes("chat")) {
    bundle.chat = useChatStore.getState().messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
      injectedMemories: m.injectedMemories,
      attachments: m.attachments?.map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        sizeLabel: a.sizeLabel,
      })),
    }));
  }

  if (kinds.includes("mood")) {
    bundle.mood = useSessionStore.getState().sessions.map((s) => ({
      id: s.id,
      title: s.title,
      mood: s.mood,
      moodLabel: s.moodLabel,
      startedAt: s.startedAt,
      status: s.status,
    }));
  }

  if (kinds.includes("memory")) {
    const { nodes, edges } = useMemoryStore.getState();
    bundle.memory = { nodes, edges };
  }

  useAuditStore.getState().log("EXPORT_MINTED", kinds.join(", "));
  return bundle;
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  metric.exportSuccess();
}

/**
 * Upload export bundle to backend (S3 storage).
 * Returns presigned URL for download.
 */
export async function uploadExportBundle(kinds: ExportKind[]): Promise<string | null> {
  const auth = getAuthHeaders();
  if (!auth) return null;

  try {
    const response = await apiClient.exportBundle(kinds, auth.token, auth.deviceId);
    metric.exportSuccess();
    return response.s3Url;
  } catch (err) {
    console.warn("[API] Failed to upload export bundle to S3:", err);
    return null;
  }
}
