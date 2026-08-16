/**
 * Unit tests — emotion mapping + on-device media analysis (pure logic).
 *
 * Vitest (frontend, environment node). Tidak menyentuh worker/DOM — hanya
 * fungsi murni: static valence/arousal mapping, prosody DSP, narrative
 * template, fused emotion, dan video timeline arc.
 */

import { describe, expect, it } from "vitest";
import {
  expressionToValenceArousal,
  secondaryEmotionFrom,
  prosodyToEmotion,
  textEmotionFrom,
} from "./emotionMapping";
import {
  analyzeImageSnapshot,
  analyzeVideoTimeline,
  analyzeAudio,
  formatDuration,
} from "./attachmentAnalysis";
import { computeProsody } from "./prosody";

const FACES = {
  sad: { expression: "sad", confidence: 0.82, updatedAt: 1, model: "mediapipe" },
  distressed: { expression: "distressed", confidence: 0.9, updatedAt: 1, model: "mediapipe" },
  neutral: { expression: "neutral", confidence: 0.6, updatedAt: 1, model: "mediapipe" },
  engaged: { expression: "engaged", confidence: 0.75, updatedAt: 1, model: "mediapipe" },
} as const;

describe("emotionMapping", () => {
  it("maps every face expression to valence/arousal (static)", () => {
    expect(expressionToValenceArousal("sad")).toEqual({ valence: -0.6, arousal: 0.3 });
    expect(expressionToValenceArousal("distressed")).toEqual({ valence: -0.8, arousal: 0.9 });
    expect(expressionToValenceArousal("neutral")).toEqual({ valence: 0, arousal: 0.3 });
    expect(expressionToValenceArousal("engaged")).toEqual({ valence: 0.5, arousal: 0.5 });
    expect(expressionToValenceArousal("tense")).toEqual({ valence: -0.4, arousal: 0.7 });
  });

  it("sad with high arousal suggests secondary anxious", () => {
    expect(secondaryEmotionFrom("sad")).toBe("anxious");
    expect(secondaryEmotionFrom("distressed")).toBe("anxious");
    expect(secondaryEmotionFrom("neutral")).toBeNull();
  });

  it("prosodyToEmotion: slow + low energy + many pauses → sad/low-arousal", () => {
    const result = prosodyToEmotion({
      avgPitch: 140,
      pitchVariance: 20,
      speechRateWpm: 90,
      pauseRatio: 0.4,
      energy: 0.25,
    });
    expect(result.emotion).toBe("sad");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it("prosodyToEmotion: fast + high pitch variance → anxious", () => {
    const result = prosodyToEmotion({
      avgPitch: 220,
      pitchVariance: 90,
      speechRateWpm: 170,
      pauseRatio: 0.05,
      energy: 0.6,
    });
    expect(result.emotion).toBe("anxious");
  });

  it("textEmotionFrom: EN hopeless phrase → hopeless", () => {
    const result = textEmotionFrom("I just feel like nothing is going right");
    expect(result.emotion).toBe("hopeless");
  });

  it("textEmotionFrom: ID sedih phrase → sad", () => {
    const result = textEmotionFrom("aku merasa sangat sedih dan sendirian");
    expect(result.emotion).toBe("sad");
  });

  it("textEmotionFrom: neutral text → neutral", () => {
    expect(textEmotionFrom("I made coffee this morning").emotion).toBe("neutral");
  });
});

describe("analyzeImageSnapshot", () => {
  it("builds emotion snapshot + narrative from face signal", () => {
    const { emotions, narrative } = analyzeImageSnapshot(FACES.sad, "During CBT session about work stress");
    expect(emotions.primary).toBe("sad");
    expect(emotions.confidence).toBe(0.82);
    expect(emotions.secondary).toBe("anxious");
    expect(emotions.valence).toBe(-0.6);
    expect(narrative).toContain("sad");
    expect(narrative).toContain("82%");
    expect(narrative).toContain("work stress");
  });

  it("narrative labels fallback model confidence as approximate", () => {
    const { narrative } = analyzeImageSnapshot({ ...FACES.sad, model: "fallback" });
    expect(narrative).toContain("approximately");
  });
});

describe("analyzeVideoTimeline", () => {
  const timeline = [
    { tMs: 0, emotion: "neutral", confidence: 0.71 },
    { tMs: 5000, emotion: "sad", confidence: 0.65 },
    { tMs: 15000, emotion: "anxious", confidence: 0.78 },
    { tMs: 30000, emotion: "sad", confidence: 0.85 },
    { tMs: 42000, emotion: "calm", confidence: 0.6 },
  ];

  it("computes dominant emotion, volatility, arc summary and narrative", () => {
    const result = analyzeVideoTimeline(timeline, { durationMs: 45000 });
    expect(result.dominantEmotion).toBe("sad");
    expect(result.volatility).toBeGreaterThan(0);
    expect(result.arcSummary).toContain("neutral");
    expect(result.narrative).toContain("45s");
    expect(result.narrative).toContain("sad");
  });

  it("single-point timeline → flat arc", () => {
    const result = analyzeVideoTimeline([{ tMs: 0, emotion: "calm", confidence: 0.6 }]);
    expect(result.volatility).toBe(0);
    expect(result.dominantEmotion).toBe("calm");
  });
});

describe("analyzeAudio", () => {
  const prosody = {
    avgPitch: 140,
    pitchVariance: 20,
    speechRateWpm: 95,
    pauseRatio: 0.35,
    energy: 0.3,
  };

  it("fuses text + prosody + face with weights 0.5/0.3/0.2", () => {
    const result = analyzeAudio({
      transcript: "I just feel like nothing is going right",
      durationMs: 120000,
      prosody,
      face: FACES.sad,
    });
    expect(result.textEmotion.emotion).toBe("hopeless");
    expect(result.fusedEmotion.sourceWeights).toEqual({ text: 0.5, prosody: 0.3, face: 0.2 });
    expect(result.fusedEmotion.emotion).toBe("hopeless");
    expect(result.fusedEmotion.confidence).toBeGreaterThan(0);
    expect(result.narrative).toContain("hopeless");
  });

  it("audio without face ignores face channel", () => {
    const result = analyzeAudio({ transcript: "ok", durationMs: 5000, prosody });
    expect(result.fusedEmotion.sourceWeights.face).toBe(0.2); // weights tetap, kontribusi 0
    expect(result.fusedEmotion.emotion).toBeTruthy();
  });

  it("narrative includes transcript excerpt, wpm, pause ratio", () => {
    const result = analyzeAudio({ transcript: "I just feel like nothing is going right", durationMs: 120000, prosody });
    expect(result.narrative).toContain("95 wpm");
    expect(result.narrative).toContain("35%");
  });
});

describe("computeProsody (DSP)", () => {
  it("detects pitch of a pure 220 Hz sine wave at 16 kHz", () => {
    const sampleRate = 16000;
    const n = sampleRate * 1.0;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      samples[i] = Math.sin((2 * Math.PI * 220 * i) / sampleRate) * 0.5;
    }
    const result = computeProsody(samples, sampleRate);
    expect(result.avgPitch).toBeGreaterThan(150);
    expect(result.avgPitch).toBeLessThan(300);
    expect(result.energy).toBeGreaterThan(0.2);
  });

  it("silence → near-zero energy, high pause ratio, no pitch", () => {
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate);
    const result = computeProsody(samples, sampleRate);
    expect(result.energy).toBeLessThan(0.01);
    expect(result.pauseRatio).toBeGreaterThan(0.9);
    expect(result.avgPitch).toBe(0);
  });

  it("computes speechRateWpm only when caller passes wordCount", () => {
    const sampleRate = 16000;
    const samples = new Float32Array(sampleRate).fill(0.1);
    const result = computeProsody(samples, sampleRate, { wordCount: 20 });
    expect(result.speechRateWpm).toBeGreaterThan(0);
  });
});

describe("formatDuration", () => {
  it("formats ms → short duration label", () => {
    expect(formatDuration(45000)).toBe("45s");
    expect(formatDuration(120000)).toBe("2m");
    expect(formatDuration(500)).toBe("0s");
  });
});
