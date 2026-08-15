# Implementation Plan: On-device feature completion (Phase 1)

## Overview

Menuntaskan 4 item partial P1 (face interval adaptif, Whisper EN+ID + Web Speech
fallback, crisis fusion multimodal, intisari rule-based) + 1 item follow-up
audit (surface WebLLM load progress ke UI). Semua berjalan on-device, zero-cloud.

## Architecture Decisions

- **Face interval adaptif** dikendalikan dari `faceClient.ts` (worker client),
  bukan worker. Mode `active|idle|crisis` didapat dari Zustand stores (`recording`,
  `isStreaming`, `crisisActive`). Interval via `setTimeout` self-scheduling, bukan
  `setInterval` — supaya perubahan mode langsung berlaku tanpa restart worker.
- **Whisper EN+ID**: tambah opsi `language` di `TranscribeIn`; frontend mengirim
  `"id"|"en"` dari `navigator.language`. Model tetap `whisper-tiny` (multilingual).
- **Web Speech fallback**: transkripsi worker gagal → fallback ke
  `webkitSpeechRecognition`. Karena Web Speech tidak bisa transkripsi blob,
  fallback hanya dipakai saat model worker gagal load (worker error). Logika di
  `voiceNote.ts` + flag per-transcription di `HoldToTalkOrb`.
- **Crisis fusion**: modul murni `computeCrisisScore({text, prosody, face})` di
  `features/crisis/lib/crisisFusion.ts`. Skor = text*0.5 + prosody*0.3 + face*0.2;
  > 0.7 → trigger. Prosody dari level audio (RMS) live, face dari `chatStore.face`,
  text dari `detectCrisis` pada user message terbaru. `CrisisFusionBridge` dipasang
  di `AppShell` seperti `CrisisHaltBridge`.
- **Intisari**: modul murni `generateIntisari(transcript)` di
  `features/chat/lib/intisari.ts`. Rule-based: keyword detection themes,
  hot cognition dari distortion markers, moodDelta dari sentimen lexicon,
  cbtPhase dari marker fase CBT. Dipanggil dari `ChatSafetyHeader` saat "End
  session" dan dipertahankan di state `chatStore`.
- **WebLLM progress**: `onDeviceLLM.ts` sudah expose `getOnDeviceLoadProgress()`;
  surfacing di UI lewat `LlmPanel` (Settings → LLM) dengan polling interval +
  progress bar saat model load.

## Task List

### Phase 1: Face interval adaptif (P1-1)
- [ ] Task 1: `faceClient.ts` adaptive interval (active 5Hz / idle 1Hz / crisis 0Hz)

### Phase 2: Whisper EN+ID + fallback (P1-2)
- [ ] Task 2: `transcribe.worker.ts` language param
- [ ] Task 3: Web Speech fallback di `voiceNote.ts` + `HoldToTalkOrb`

### Phase 3: Crisis fusion multimodal (P1-3)
- [ ] Task 4: `crisisFusion.ts` (computeCrisisScore pure module)
- [ ] Task 5: `CrisisFusionBridge` + mount di `AppShell`

### Phase 4: Intisari rule-based (P1-4)
- [ ] Task 6: `intisari.ts` generator + state di chatStore
- [ ] Task 7: wire ke `ChatSafetyHeader` (End session) + tampilan

### Phase 5: WebLLM progress UI (follow-up audit)
- [ ] Task 8: progress bar WebLLM di `LlmPanel`

### Checkpoint: Complete
- [ ] `npm run typecheck` (frontend) pass
- [ ] `npx tsc --noEmit` (lambda) pass — hanya jika lambda berubah (tidak)
- [ ] Review multi-axis (code-review-and-quality)
- [ ] Update PROGRESS.md + AUDIT.md status P1

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| MediaPipe/interval restart saat mode berubah | flicker | self-scheduling setTimeout, tidak terminate worker |
| Web Speech API tidak tersedia (bukan Chrome/Safari) | fallback gagal | guard `typeof SpeechRecognition !== "undefined"`; fallback tetap ke error toast |
| Prosody live level bergantung pada recording | fusion bias saat idle | prosody hanya >0 saat `recording`; saat idle berkontribusi 0 |
| Crisis false-positive dari fusion | overlay salah | threshold 0.7 + bobot rendah; hanya text marker yang self-trigger (>0.5? text 0.5 ≤0.7 → butuh konfirmasi prosody/face) |
| Whisper model gagal load | transkripsi mati | Web Speech fallback + error toast |

## Open Questions

- (tidak ada — scope jelas dari PROGRESS.md)
