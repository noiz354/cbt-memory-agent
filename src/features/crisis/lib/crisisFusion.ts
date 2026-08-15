import type { FaceSignal } from "@/features/chat/types";
import { detectCrisis } from "./detectCrisis";

/**
 * Multimodal crisis fusion.
 *
 * Score = text*0.5 + prosody*0.3 + face*0.2  (all normalized to 0..1).
 * Threshold: score > 0.7 triggers the crisis protocol.
 *
 * - text:    binary — crisis phrase matched on the latest user message (detectCrisis).
 *            Text-only (0.5) does NOT trigger fusion by itself; that case is
 *            already handled synchronously in chatStore.sendMessage.
 * - prosody: RMS level of the live mic while recording (0 when idle).
 * - face:    MediaPipe blendshape classification; 0 unless model === "mediapipe".
 *
 * Design is deliberately conservative (fail-safe): facial/prosodic signals alone
 * can never cross the threshold — the app must not raise a crisis alarm on a
 * frown or a raised voice without textual corroboration. The fusion layer's job
 * is to ratify/confirm distress when multimodal evidence agrees, and to feed the
 * on-screen distress hint for sub-threshold signals.
 */

export const CRISIS_FUSION_WEIGHTS = { text: 0.5, prosody: 0.3, face: 0.2 } as const;
export const CRISIS_FUSION_THRESHOLD = 0.7;

export interface CrisisFusionInput {
  text: string;
  prosody: number;
  face: FaceSignal;
}

export interface CrisisFusionResult {
  score: number;
  textHit: boolean;
  faceDistressed: boolean;
  shouldTrigger: boolean;
}

export function computeTextScore(text: string): number {
  return detectCrisis(text) ? 1 : 0;
}

export function computeFaceScore(face: FaceSignal): number {
  if (face.model !== "mediapipe") return 0;
  switch (face.expression) {
    case "distressed":
      return 1;
    case "tense":
    case "sad":
      return 0.6;
    default:
      return 0;
  }
}

/**
 * Face-only distress hint for the on-screen indicator. Unlike computeFaceScore
 * (weighted crisis fusion, mediapipe-only), this accepts a luma/fallback
 * "distressed" reading when confidence is high enough — it is informational,
 * never a trigger.
 */
export function computeDistressHint(face: FaceSignal): boolean {
  if (face.expression !== "distressed") return false;
  return face.model === "mediapipe" || face.confidence > 0.7;
}

/** Map mic RMS (0..1) to a prosody score; only meaningful while recording. */
export function computeProsodyScore(rms: number): number {
  if (rms <= 0) return 0;
  return Math.min(1, Math.max(0, (rms - 0.08) / 0.6));
}

export function computeCrisisScore(input: CrisisFusionInput): CrisisFusionResult {
  const textScore = computeTextScore(input.text);
  const prosodyScore = computeProsodyScore(input.prosody);
  const faceScore = computeFaceScore(input.face);

  const score =
    textScore * CRISIS_FUSION_WEIGHTS.text +
    prosodyScore * CRISIS_FUSION_WEIGHTS.prosody +
    faceScore * CRISIS_FUSION_WEIGHTS.face;

  return {
    score,
    textHit: textScore >= 1,
    faceDistressed: faceScore >= 1,
    shouldTrigger: score > CRISIS_FUSION_THRESHOLD,
  };
}
