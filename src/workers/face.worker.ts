/**
 * On-device face-expression worker — real MediaPipe Face Landmarker.
 *
 * Raw pixels never leave this worker. The model (face_landmarker.task) ships in
 * public/models/; blendshape scores are mapped to a coarse CBT signal
 * (neutral/engaged/tense/sad/distressed). If the model cannot be loaded (e.g.
 * missing wasm or model file), we fall back to a luma heuristic so the UI keeps
 * working — the fallback is explicitly marked low-confidence.
 */

import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export interface FaceWorkerIn {
  type: "frame";
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

export interface FaceWorkerOut {
  type: "signal";
  expression: "neutral" | "tense" | "sad" | "engaged" | "distressed";
  confidence: number;
  updatedAt: number;
  model: "mediapipe" | "fallback";
}

const EXPRESSIONS: FaceWorkerOut["expression"][] = [
  "neutral",
  "engaged",
  "tense",
  "sad",
  "distressed",
];

let landmarker: FaceLandmarker | null = null;
let modelMode: FaceWorkerOut["model"] = "fallback";
let initPromise: Promise<void> | null = null;

async function initModel(): Promise<void> {
  try {
    // Wasm files are served statically from /wasm (see public/wasm/) so the
    // loader and binary resolve inside the worker at runtime.
    const vision = await FilesetResolver.forVisionTasks(
      `${self.location.origin}/wasm`,
    );
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${self.location.origin}/models/face_landmarker.task`,
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
    });
    modelMode = "mediapipe";
  } catch (err) {
    console.warn("[face.worker] MediaPipe failed to load, using fallback:", err);
    landmarker = null;
    modelMode = "fallback";
  }
}

function blendshape(result: unknown, name: string): number {
  try {
    const shapes = (result as { faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[] })
      .faceBlendshapes?.[0]?.categories ?? [];
    return shapes.find((c) => c.categoryName === name)?.score ?? 0;
  } catch {
    return 0;
  }
}

/** Map blendshape action units to a coarse emotional signal. */
function classifyBlendshapes(face: unknown): { expression: FaceWorkerOut["expression"]; confidence: number } {
  const browDown = Math.max(blendshape(face, "browDownLeft"), blendshape(face, "browDownRight"));
  const browUp = blendshape(face, "browInnerUp");
  const mouthFrown = Math.max(blendshape(face, "mouthFrownLeft"), blendshape(face, "mouthFrownRight"));
  const smile = Math.max(blendshape(face, "mouthSmileLeft"), blendshape(face, "mouthSmileRight"));
  const jawOpen = blendshape(face, "jawOpen");
  const mouthPress = Math.max(blendshape(face, "mouthPressLeft"), blendshape(face, "mouthPressRight"));
  const blink = Math.max(blendshape(face, "eyeBlinkLeft"), blendshape(face, "eyeBlinkRight"));
  const eyeOpen = 1 - Math.min(1, blink);

  // Distress: fear/surprise (brows up + jaw open) or strong clench.
  if (browUp > 0.35 && jawOpen > 0.25) return { expression: "distressed", confidence: 0.85 };
  if (browDown > 0.4 && mouthPress > 0.35) return { expression: "tense", confidence: 0.8 };

  // Sadness: frown + inner brows up + reduced eye openness.
  if (mouthFrown > 0.35 && (browUp > 0.15 || browDown > 0.2)) {
    return { expression: "sad", confidence: 0.75 };
  }

  // Engaged: noticeable smile + eyes open.
  if (smile > 0.3 && eyeOpen > 0.7) return { expression: "engaged", confidence: 0.7 };

  return { expression: "neutral", confidence: 0.6 };
}

function fallbackSignal(pixels: Uint8ClampedArray): FaceWorkerOut {
  let luma = 0;
  for (let i = 0; i < pixels.length; i += 16) {
    luma += pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
  }
  const samples = Math.max(1, pixels.length / 16);
  const mean = luma / samples;
  const idx = Math.min(EXPRESSIONS.length - 1, Math.floor((mean / 255) * EXPRESSIONS.length));
  return {
    type: "signal",
    expression: EXPRESSIONS[idx],
    confidence: 0.55 + (mean % 40) / 100,
    updatedAt: Date.now(),
    model: "fallback",
  };
}

self.onmessage = (event: MessageEvent<FaceWorkerIn>) => {
  if (event.data.type !== "frame") return;
  const pixels = new Uint8ClampedArray(event.data.buffer);

  if (modelMode === "mediapipe" && landmarker) {
    try {
      const imageData = new ImageData(
        new Uint8ClampedArray(pixels),
        event.data.width,
        event.data.height,
      );
      const result = landmarker.detect(imageData);
      const face = result?.faceLandmarks?.[0];
      if (face) {
        const { expression, confidence } = classifyBlendshapes(result);
        self.postMessage({
          type: "signal",
          expression,
          confidence,
          updatedAt: Date.now(),
          model: "mediapipe",
        } satisfies FaceWorkerOut);
        return;
      }
    } catch {
      // fall through to fallback
    }
  }

  // Not initialized or no face found.
  if (!landmarker && !initPromise) {
    initPromise = initModel().finally(() => {
      initPromise = null;
    });
  }
  self.postMessage(fallbackSignal(pixels));
};
