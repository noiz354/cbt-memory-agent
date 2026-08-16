/**
 * On-device media analysis → narrative template (deterministik, tanpa LLM).
 *
 * Tiga pipeline:
 * - analyzeImageSnapshot  : snapshot emosi tunggal (facial expression).
 * - analyzeVideoTimeline  : timeline emosi temporal + arc summary + volatility.
 * - analyzeAudio          : transcript + prosody + fused emotion
 *                           (text 0.5 · prosody 0.3 · face 0.2).
 *
 * Setiap fungsi murni (pure) — mudah di-test dan dipakai worker/main thread.
 * Hasilnya `embedded_narrative` yang dikirim ke backend untuk embedding.
 */

import type { FaceSignal } from "@/features/chat/types";
import {
  emotionToValenceArousal,
  expressionToValenceArousal,
  secondaryEmotionFrom,
  prosodyToEmotion,
  textEmotionFrom,
  type ProsodyFeatures,
} from "./emotionMapping";

export interface EmotionSnapshot {
  primary: string;
  confidence: number;
  secondary?: string;
  valence: number;
  arousal: number;
}

export interface ImageAnalysis {
  emotions: EmotionSnapshot;
  narrative: string;
}

export interface TimelinePoint {
  tMs: number;
  emotion: string;
  confidence: number;
}

export interface VideoAnalysis {
  timeline: TimelinePoint[];
  arcSummary: string;
  dominantEmotion: string;
  volatility: number;
  narrative: string;
}

export interface AudioAnalysisInput {
  transcript: string;
  durationMs: number;
  prosody: ProsodyFeatures;
  face?: FaceSignal;
}

export interface AudioAnalysis {
  textEmotion: { emotion: string; confidence: number };
  fusedEmotion: {
    emotion: string;
    confidence: number;
    sourceWeights: { text: number; prosody: number; face: number };
  };
  narrative: string;
}

const SESSION_CONTEXT = "during this session";

export function analyzeImageSnapshot(face: FaceSignal, context?: string): ImageAnalysis {
  const va = expressionToValenceArousal(face.expression);
  const secondary = secondaryEmotionFrom(face.expression) ?? undefined;
  const confidencePct = Math.round(face.confidence * 100);

  const primaryLabel = face.expression;
  const narrative =
    `User appeared ${primaryLabel} (${confidencePct}% confidence)` +
    (secondary ? ` with secondary ${secondary}` : "") +
    ` ${context ?? SESSION_CONTEXT}.`;

  return {
    emotions: {
      primary: face.expression,
      confidence: face.confidence,
      secondary,
      valence: va.valence,
      arousal: va.arousal,
    },
    // Fallback model = heuristic luma → tandai sebagai perkiraan.
    narrative: face.model === "fallback" ? narrative.replace("confidence", "approximately confidence") : narrative,
  };
}

export function analyzeVideoTimeline(
  points: TimelinePoint[],
  meta?: { durationMs?: number; context?: string },
): VideoAnalysis {
  const timeline = [...points].sort((a, b) => a.tMs - b.tMs);

  const dominant = dominantEmotion(timeline);
  const volatility = arousalVolatility(timeline);
  const arcSummary = buildArcSummary(timeline);

  const durationLabel = formatDuration(meta?.durationMs ?? lastT(timeline));
  const dominantPct = Math.round(
    (timeline.find((p) => p.emotion === dominant)?.confidence ?? 0) * 100,
  );

  const narrative =
    `${durationLabel} video: ${arcSummary}. ` +
    `Dominant emotion ${dominant} (${dominantPct}%). ` +
    `Emotional volatility ${round2(volatility)}.` +
    (meta?.context ? ` ${meta.context}.` : "");

  return { timeline, arcSummary, dominantEmotion: dominant, volatility, narrative };
}

export function analyzeAudio(input: AudioAnalysisInput): AudioAnalysis {
  const textEmotion = textEmotionFrom(input.transcript);
  const prosodyEmotion = prosodyToEmotion(input.prosody);

  // Face channel hanya dipakai bila model mediapipe (bukan fallback luma).
  const face = input.face && input.face.model === "mediapipe" ? input.face : undefined;
  const faceEmotion = face
    ? { emotion: face.expression, confidence: face.confidence }
    : null;

  const weights = { text: 0.5, prosody: 0.3, face: 0.2 };
  const scores = new Map<string, number>();
  addScore(scores, textEmotion.emotion, textEmotion.confidence * weights.text);
  addScore(scores, prosodyEmotion.emotion, prosodyEmotion.confidence * weights.prosody);
  if (faceEmotion) addScore(scores, faceEmotion.emotion, faceEmotion.confidence * weights.face);

  let fusedEmotion = "neutral";
  let bestScore = 0;
  for (const [emotion, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      fusedEmotion = emotion;
    }
  }

  const availableWeight = (face ? 1 : 0.8);
  const fusedConfidence = clamp01(bestScore / availableWeight);

  const narrative =
    `User said: "${excerpt(input.transcript, 120)}". ` +
    `Voice analysis: ${input.prosody.speechRateWpm} wpm, ` +
    `${Math.round(input.prosody.pauseRatio * 100)}% pauses, ` +
    `${input.prosody.energy} energy. ` +
    `Fused emotion: ${fusedEmotion} (${Math.round(fusedConfidence * 100)}% confidence).`;

  return {
    textEmotion,
    fusedEmotion: { emotion: fusedEmotion, confidence: fusedConfidence, sourceWeights: weights },
    narrative,
  };
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  return `${Math.floor(totalSeconds / 60)}m`;
}

function dominantEmotion(points: TimelinePoint[]): string {
  const counts = new Map<string, number>();
  for (const p of points) {
    counts.set(p.emotion, (counts.get(p.emotion) ?? 0) + p.confidence);
  }
  let best = "neutral";
  let bestScore = 0;
  for (const [emotion, score] of counts) {
    if (score > bestScore) {
      bestScore = score;
      best = emotion;
    }
  }
  return best;
}

/** Volatility = stddev dari arousal sepanjang timeline. */
function arousalVolatility(points: TimelinePoint[]): number {
  if (points.length === 0) return 0;
  const arousal = points.map((p) => emotionToValenceArousal(p.emotion).arousal);
  const mean = arousal.reduce((a, b) => a + b, 0) / arousal.length;
  const variance = arousal.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arousal.length;
  return round2(Math.sqrt(variance));
}

/** Ringkasan arc berbasis transisi emosi (template deterministik). */
function buildArcSummary(points: TimelinePoint[]): string {
  if (points.length <= 1) return `Started ${points[0]?.emotion ?? "neutral"}`;

  const unique: string[] = [];
  for (const p of points) {
    if (unique[unique.length - 1] !== p.emotion) unique.push(p.emotion);
  }
  const last = unique[unique.length - 1];
  const first = unique[0];
  return `Started ${first}, shifted to ${unique.slice(1, -1).join(", ") || last}${unique.length > 2 ? `, settled to ${last}` : ""}`;
}

function addScore(scores: Map<string, number>, emotion: string, score: number): void {
  scores.set(emotion, (scores.get(emotion) ?? 0) + score);
}

function excerpt(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 3)}...` : trimmed;
}

function lastT(points: TimelinePoint[]): number {
  if (points.length === 0) return 0;
  return points[points.length - 1].tMs;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
