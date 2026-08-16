import { apiClient, type AttachmentAnalysisInput } from "@/shared/lib/apiClient";
import { getAuthHeaders } from "@/shared/lib/authSession";

export interface IndexAttachmentInput {
  kind: AttachmentAnalysisInput["kind"];
  blob: Blob;
  mimeType: string;
  ext?: string;
  analysis: Record<string, unknown>;
  embeddedNarrative: string;
  title: string;
  confidence?: number;
  durationMs?: number;
  frameCount?: number;
  sessionId?: string;
  turnId?: string;
}

export interface IndexAttachmentResult {
  nodeId: string;
  attachmentId: string;
}

/**
 * Orchestrates the full on-device → backend attachment pipeline:
 *   1. presign a PUT URL for the raw media
 *   2. upload the blob straight to S3
 *   3. create the kind=attachment memory node + embedding + analysis row
 * Throws on any failure so the caller can surface a toast.
 */
export async function indexAttachment(input: IndexAttachmentInput): Promise<IndexAttachmentResult> {
  const auth = getAuthHeaders();
  if (!auth) throw new Error("Not authenticated.");

  const { key, uploadUrl } = await apiClient.presignMedia(
    { v: 1, kind: input.kind, ext: input.ext, mimeType: input.mimeType },
    auth.token,
    auth.deviceId,
  );

  await apiClient.uploadMediaToS3(uploadUrl, input.blob, input.mimeType);

  const res = await apiClient.createAttachment(
    {
      v: 1,
      attachment: {
        kind: input.kind,
        analysis: input.analysis,
        embeddedNarrative: input.embeddedNarrative,
        s3Key: key,
        title: input.title,
        confidence: input.confidence,
        mimeType: input.mimeType,
        sizeBytes: input.blob.size,
        durationMs: input.durationMs,
        frameCount: input.frameCount,
        sessionId: input.sessionId,
        turnId: input.turnId,
      },
    },
    auth.token,
    auth.deviceId,
  );

  return { nodeId: res.nodeId, attachmentId: res.attachmentId };
}
