# Metrics Quick Reference — Frontend Hook Points

> Copy-paste ini saat menambahkan metric call ke komponen.
> **Aturan:** Frontend hanya supply data (`metric.xxx()`). Jangan hitung persentase.

---

## Crisis (A: 1-10)

```tsx
// CrisisOverlay.tsx — saat mount
metric.crisisOverlayOpened();

// CrisisOverlay.tsx — saat dismissed <15s tanpa grounding/call
metric.crisisFalseShort();

// BreathingCircle.tsx — saat siklus 4-7-8 selesai
metric.crisisGroundingDone();

// GroundingGame.tsx — saat 5 titik selesai
metric.crisisGroundingDone();

// CrisisOverlay.tsx — saat dismiss setelah grounding unlock
metric.crisisSafeExit();

// SwipeToCall.tsx — saat tap 988/119
metric.crisisLifelineTap();

// CrisisHaltBridge.tsx — saat hardHalt sukses
metric.crisisHardHaltOk();

// CrisisOverlay.tsx — saat focus trap verified (no Tab/Esc escape)
metric.crisisFocusTrapOk();

// CameraPip.tsx — saat distressed tapi TIDAK halt
metric.distressHintNoHalt();

// CameraPip.tsx — saat distressed hint diterima (total)
metric.distressHintTotal();
```

## Consent & Privacy (B: 11-20)

```tsx
// ConsentSlider.tsx — saat accept
metric.consentCompleted();

// ConsentSlider.tsx — saat scroll ke bottom sebelum accept
metric.consentScrollHonest();

// ConsentSlider.tsx — saat End key tanpa scroll
metric.consentShortcut();

// ExportBuilder.tsx — saat JSON valid terunduh
metric.exportSuccess();

// DestructionKey.tsx — saat mulai ketik/hold
metric.purgeStarted();

// DestructionKey.tsx — saat selesai full sequence
metric.purgeCompleted();

// DestructionKey.tsx — saat batal di tengah
metric.purgeAbandon();

// hardPurge.ts — verifikasi sisa key
metric.postPurgeResidue(count);

// TabSync.tsx — saat cross-tab sign-out sukses
metric.crossTabSignOutOk();
```

## Activation (C: 21-27)

```tsx
// OnboardingPage.tsx — saat finish onboarding + 1st chat
metric.activationD0();

// ChatPage.tsx — saat End session
metric.sessionFinalized();

// sessionStore.ts — saat status interrupted
metric.sessionOrphaned();

// sessionStore.ts — saat retryInterrupted sukses
metric.sessionRequeueOk();

// ChatPage.tsx — saat session finalized dengan goal match
metric.goalSessionAligned();
```

## CBT Quality (D: 28-35)

```tsx
// SpatialDndProvider.tsx — saat memory inject
metric.turnWithMemory();

// MemoryRail.tsx — saat inject ditolak (confidence<0.6)
metric.turnRejectedUnverified();

// Recall chip — saat klik ke /memory
metric.recallChipClicked();

// ChatBubble.tsx — saat assistant reply ada CBT distortion tag
metric.distortionMarked();

// ChatBubble.tsx — saat barge-in/swipe halt stream
metric.bargeInDone();
```

## Spatial/DnD (E: 36-41)

```tsx
// SpatialDndProvider.tsx — saat drop di valid dropzone
metric.dndSuccess();

// GraphCanvas.tsx — saat link baru dibuat
metric.graphLinkCreated();

// PurgeZone.tsx — saat node dibakar
metric.purgeFromGraph();

// CompareModal.tsx — saat modal dibuka
metric.compareOpened();

// MoodSparkline.tsx — saat scrub highlight card
metric.sparklineScrub();

// ConsentSlider.tsx — saat reach 90% track
metric.consentSlider90();
```

## Reliability (F: 42-48)

```tsx
// ErrorBoundary.tsx — saat boundary triggered
metric.crashBoundary();

// ErrorBoundary.tsx (di dalam crisis) — saat crash tapi overlay tetap
metric.crisisSafeCrash();

// chatStore.ts — saat streamTokens selesai tanpa truncated
metric.streamDone();

// chatStore.ts — saat 29s timeout
metric.streamTruncated();

// chatStore.ts — saat resumeStream sampai done
metric.resumeSuccess();

// face.worker.ts / audio.worker.ts — saat pesan valid
metric.workerValid();

// face.worker.ts / audio.worker.ts — saat parse fail
metric.workerParseFail();

// versionedPersist.ts — saat migrasi sukses
metric.migrationOk();

// AppShell.tsx — saat release tag valid
metric.releaseTagged();
```
