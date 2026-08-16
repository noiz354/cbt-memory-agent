/**
 * Static emotion mapping — on-device, deterministik, tanpa model tambahan.
 *
 * Face pipeline mengeluarkan label kategorikal (neutral/engaged/tense/sad/
 * distressed) + confidence. Modul ini memetakannya ke valence/arousal
 * (untuk narrative + volatility) dan ke emosi sekunder. Juga menyediakan
 * prosody → emosi dan teks → emosi (lexicon EN/ID) untuk audio.
 */

export type FaceExpression = "neutral" | "engaged" | "tense" | "sad" | "distressed";

export interface ValenceArousal {
  valence: number; // -1 (negatif) .. +1 (positif)
  arousal: number; // 0 (tenang) .. 1 (terangsang)
}

/** Static mapping ekspresi wajah → valence/arousal (skala circumplex). */
export const EXPRESSION_VA: Record<FaceExpression, ValenceArousal> = {
  neutral: { valence: 0, arousal: 0.3 },
  engaged: { valence: 0.5, arousal: 0.5 },
  tense: { valence: -0.4, arousal: 0.7 },
  sad: { valence: -0.6, arousal: 0.3 },
  distressed: { valence: -0.8, arousal: 0.9 },
};

/** Mapping emosi apa pun (face, prosody, text) → valence/arousal. */
const EMOTION_VA: Record<string, ValenceArousal> = {
  ...EXPRESSION_VA,
  anxious: { valence: -0.5, arousal: 0.8 },
  calm: { valence: 0.4, arousal: 0.2 },
  hopeless: { valence: -0.9, arousal: 0.4 },
  tired: { valence: -0.2, arousal: 0.1 },
  angry: { valence: -0.7, arousal: 0.85 },
  irritable: { valence: -0.5, arousal: 0.6 },
};

export function expressionToValenceArousal(expression: FaceExpression): ValenceArousal {
  return EMOTION_VA[expression] ?? EMOTION_VA.neutral;
}

/** valence/arousal untuk label emosi apa pun (dipakai volatility video). */
export function emotionToValenceArousal(emotion: string): ValenceArousal {
  return EMOTION_VA[emotion] ?? EMOTION_VA.neutral;
}

/** Emosi sekunder dari ekspresi utama (rule sederhana). */
export function secondaryEmotionFrom(expression: FaceExpression): string | null {
  switch (expression) {
    case "sad":
      return "anxious";
    case "distressed":
      return "anxious";
    case "tense":
      return "irritable";
    default:
      return null;
  }
}

export interface ProsodyFeatures {
  avgPitch: number;
  pitchVariance: number;
  speechRateWpm: number;
  pauseRatio: number;
  energy: number;
}

/**
 * Prosody → emosi. Heuristik deterministik:
 * - lambat + pause banyak + energi rendah → sad
 * - cepat + pitch variance tinggi → anxious
 * - sedang + relaks → calm
 */
export function prosodyToEmotion(p: ProsodyFeatures): { emotion: string; confidence: number } {
  const slow = p.speechRateWpm < 110;
  const manyPauses = p.pauseRatio > 0.25;
  const lowEnergy = p.energy < 0.35;
  const fast = p.speechRateWpm > 150;
  const highPitchVar = p.pitchVariance > 60;

  if (slow && manyPauses && lowEnergy) {
    return { emotion: "sad", confidence: clamp(0.55 + (0.4 - p.pauseRatio) * 0.5) };
  }
  if (fast && highPitchVar) {
    return { emotion: "anxious", confidence: clamp(0.55 + (p.pitchVariance - 60) / 200) };
  }
  if (lowEnergy && manyPauses) {
    return { emotion: "tired", confidence: 0.6 };
  }
  return { emotion: "calm", confidence: 0.6 };
}

/** Lexicon emosi EN/ID — teks → emosi (confidence heuristic). */
const TEXT_LEXICON: { emotion: string; words: string[] }[] = [
  { emotion: "hopeless", words: ["hopeless", "nothing is going right", "no point", "give up", "can't go on"] },
  { emotion: "anxious", words: ["anxious", "worried", "scared", "panic", "khawatir", "cemas", "takut", "panik"] },
  { emotion: "sad", words: ["sad", "depressed", "down", "cry", "sedih", "sendiri", "sendirian", "kosong"] },
  { emotion: "angry", words: ["angry", "furious", "marah", "kesal", "benci"] },
  { emotion: "calm", words: ["calm", "better", "relaxed", "tenang", "lebih baik", "baik"] },
];

export function textEmotionFrom(text: string): { emotion: string; confidence: number } {
  const lower = ` ${text.toLowerCase()} `;
  let best: { emotion: string; confidence: number } | null = null;
  for (const entry of TEXT_LEXICON) {
    for (const word of entry.words) {
      if (lower.includes(word)) {
        const confidence = clamp(0.6 + word.length / 200);
        if (!best || confidence > best.confidence) {
          best = { emotion: entry.emotion, confidence };
        }
      }
    }
  }
  return best ?? { emotion: "neutral", confidence: 0.5 };
}

function clamp(v: number): number {
  return Math.min(1, Math.max(0, v));
}
