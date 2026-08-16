# Frontend Integration Audit
_Generated: 2026-08-16_
_Auditor: senior frontend engineer — automated codebase inspection_

## Executive Summary

The CBT Memory Agent frontend has strong coverage of the memory graph, sessions, and
media-ingest flows — most core data paths are backed by real API data with honest
loading/error/empty states. However, three whole backend capability families are
**completely dark to users** (analytics funnel/activity/retention, monetization, and the
attachment read/gallery API), the SSE stream from `/chat/turn` is only partially consumed
(`injectedMemoryIds` emitted by the backend is never parsed; there is no `AbortController`,
so barge-in/hard-halt are cosmetic), and the chat transcript is demo seed data that is
never hydrated from the backend. These gaps are **demo-visible**: a reviewer watching the
demo will see seeded chat content, no recalled-memory evidence on the stream, and no way to
list the attachments the media pipeline just created.

## Integration Coverage Table

| Section | Total Items | ✅ | ⚠️ | ❌ | 🔧 | Coverage |
|---|---|---|---|---|---|---|
| 1. API Routes | 26 | 16 | 3 | 7 | 0 | 73% |
| 2. SSE / Streaming | 9 | 2 | 3 | 4 | 0 | 56% |
| 3. Memory Features | 12 | 12 | 0 | 0 | 0 | 100% |
| 4. Sessions | 6 | 4 | 2 | 0 | 0 | 100% |
| 5. Analytics & Metrics | 7 | 2 | 1 | 4 | 0 | 43% |
| 6. Export | 6 | 3 | 2 | 0 | 1 | 83% |
| 7. Auth | 6 | 2 | 1 | 3 | 0 | 50% |
| 8. Crisis Features | 5 | 2 | 1 | 2 | 0 | 60% |
| 9. Audit Events | 6 | 0 | 3 | 3 | 0 | 50% |
| 10. Observability / Telemetry | 5 | 1 | 2 | 2 | 0 | 60% |
| 11. BYOK / Privacy | 5 | 2 | 1 | 2 | 0 | 60% |
| 12. Error States | 7 | 1 | 4 | 2 | 0 | 71% |
| **TOTAL** | 100 | 47 | 23 | 29 | 1 | 70% |

Coverage = (✅ + ⚠️) / total. Items are backend capabilities, SSE event types, audit event
types, or cross-cutting behaviors — counted individually per section.

## DEMO-BLOCKER Items

| Section | Item | GAP | USER IMPACT | COMPONENT | EFFORT |
|---|---|---|---|---|---|
| 2 | SSE `injectedMemoryIds` event | Backend emits `{"t":"","injectedMemoryIds":[...]}` at end of stream (`lambda/handlers/chatTurn.ts:162-164`) but neither SSE parser reads it (`src/shared/lib/llmClient.ts:255-265` only reads `json.t`; `src/shared/lib/apiClient.ts:229-238` same) | Reviewer never sees WHICH memories were injected — the core "agent remembers you" demo moment is invisible | `src/shared/lib/llmClient.ts` (parseBackendProxySSE) → `src/features/chat/store/chatStore.ts` → `ChatBubble.tsx` | XS |
| 2 | `recalled_titles` never surfaced | Backend stores recall titles as a span attribute only (`chatTurn.ts:90`), never in SSE; frontend has zero `recalled_titles` references | User cannot see what the agent recalled for a turn | `lambda/handlers/chatTurn.ts` + SSE contract; `SessionDetailPage.tsx` | S |
| 3 | Chat transcript is seed data, never hydrated | `chatStore.ts:57-85` seeds 3 hardcoded messages; no `listSessionTurns` hydrate on open; chat is in-memory only, not persisted | Demo shows a canned conversation; reopening the app loses the chat the reviewer just had | `src/features/chat/store/chatStore.ts` (hydrate + persist) | S |
| 5 | No analytics UI at all | Backend implements `GET /analytics/funnel`, `/analytics/activity`, `/analytics/retention` (`lambda/handlers/analytics.ts:55-89`) but `src/features/metrics/` only has `MetricsPage` calling `/metrics` | The entire analytics backend is invisible to users | `src/features/metrics/pages/MetricsPage.tsx` (add tabs) or new pages | M |
| 1 | Attachment gallery missing | `apiClient.listAttachments` (`apiClient.ts:437-438`) and `deleteAttachment` (`:441-446`) exist but are called by **zero** components | User can create attachments but can never see or delete them from the UI | `src/features/memory/` or `src/features/chat/` gallery component | S |

## HIGH Priority Items

| Section | Item | GAP | USER IMPACT | COMPONENT | EFFORT |
|---|---|---|---|---|---|
| 2 | No AbortController anywhere | `bargeIn`/`hardHalt` (`chatStore.ts:287-338`) only flip local state; the fetch stream keeps running | "Stop" button doesn't actually stop the LLM call — wasted tokens + ghost streaming | `src/shared/lib/llmClient.ts` + `chatStore.ts` | S |
| 7 | Passkey auth half-implemented | `passkey.ts:13-54` calls `navigator.credentials.create` but there is **no `credentials.get`** anywhere | "Sign in with passkey" always registers a new local profile; returning users can't authenticate | `src/features/auth/lib/passkey.ts` + `PasskeyPanel.tsx` | S |
| 7 | No session-expiry detection | `magicTokenExpiresAt` set (`authStore.ts:101`) but never read; no 401 interceptor | Expired sessions fail silently; user stays in a broken "authenticated" UI | `src/shared/lib/apiClient.ts` (401 hook) + `authStore.ts` | S |
| 8 | Crisis events never reach backend | Frontend logs `CRISIS_ENGAGED`/`CRISIS_DISMISSED` to **local** audit store (`CrisisOverlay.tsx:36,140`) + telemetry; backend `/metrics` `crisisEvents` counts `audit_events` rows that nothing writes (`health.ts:69`) | Crisis engagement metric is always 0; no server-side crisis record | `src/features/crisis/components/CrisisOverlay.tsx` → `apiClient.trackEvent`/new audit call | S |
| 9 | No audit UI for server events | `AuditPanel` shows the **local** 80-event log (`privacyStore`/`auditStore`); `REFLECTION_RAN` and `CLUSTER_HEALTH_CHECK` appear nowhere in the frontend | No visibility into the reflection loop or cluster health the backend is producing | `src/features/privacy/components/AuditPanel.tsx` or new debug view | M |
| 10 | No Web Vitals tracking | No `web-vitals` package in `package.json`; no PerformanceObserver | No LCP/CLS/INP data for a product judged partly on polish | `src/shared/lib/telemetry.ts` (add vitals) | S |
| 12 | 401s not globally handled | No 401 interceptor in `apiClient.ts:24-46`; errors bubble as generic `Error("API 401: ...")` | Users get a raw error instead of a clean redirect to `/auth` | `src/shared/lib/apiClient.ts` | XS |
| 12 | No 429 handling | Rate-limit responses fall into the generic error path with no retry hint | Users blocked silently during bursts | `src/shared/lib/apiClient.ts` | XS |

## Section-by-Section Detail

### Section 1 — API Routes

| Route | Method | Backend Handler | apiClient call | Component | Status | GAP | USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|---|---|---|---|
| /api/v1/auth/magic-link | POST | `handlers/auth.ts:101` | `requestMagicLink` (`apiClient.ts:341-345`) | `MagicLinkForm.tsx` | ✅ | — | — | — | — |
| /api/v1/auth/callback | POST | `handlers/auth.ts:154` | `consumeMagicLink` (`apiClient.ts:348-352`) | `AuthCallbackPage.tsx` | ✅ | — | — | — | — |
| /api/v1/telemetry | POST | `handlers/telemetry.ts:20` | OTLP exporter → `/api/v1/telemetry` (`telemetry.ts:35-39`) | `shared/lib/telemetry.ts` | ⚠️ | Gated behind `VITE_OTEL_ENABLED==="true"` (default false, `.env.example:42`); traces only, no web vitals | Observability off by default | `telemetry.ts` | S | MEDIUM |
| /api/v1/chat/turn | POST | `handlers/chatTurn.ts:47` | `chatTurn` (`apiClient.ts:189-251`) + raw fetch in `llmClient.ts:211` | `chatStore.sendMessage` → `ChatBubble` | ⚠️ | Streams only read `json.t`; `injectedMemoryIds` ignored; fire-and-forget sync call passes no `onChunk` (`chatStore.ts:234`) | No recalled-memory evidence in-stream | see Section 2 | XS | DEMO-BLOCKER |
| /api/v1/memory | GET | `handlers/memory.ts:47` | `listMemory` (`apiClient.ts:254-255`) | `memoryStore.hydrate` → `MemoryPage` | ✅ | — | — | — | — |
| /api/v1/memory | POST | `handlers/memory.ts:97` | `upsertMemory` (`apiClient.ts:258-267`) | `AddMemoryModal` / `NodeInspector` / `GraphCanvas` | ✅ | — | — | — | — |
| /api/v1/memory/:id | DELETE | `handlers/memory.ts:200` | `deleteMemory` (`apiClient.ts:270-275`) | `GraphCanvas` PurgeZone / `NodeInspector` | ✅ | — | — | — | — |
| /api/v1/memory/edge/:id | DELETE | `handlers/memory.ts:223` | `deleteMemoryEdge` (`apiClient.ts:278-283`) | `NodeInspector` Link2Off | ✅ | — | — | — | — |
| /api/v1/memory/semantic | GET | `handlers/semanticSearch.ts:24` | `searchMemory` (`apiClient.ts:286-296`) | `MemoryPage.tsx:32-49` | ✅ | — | — | — | — |
| /api/v1/session | POST | `handlers/session.ts:32` | `saveSession` (`apiClient.ts:299-308`) | `sessionStore.setStatus` / `addSession` | ✅ | — | — | — | — |
| /api/v1/sessions | GET | `handlers/session.ts:107` | `listSessions` (`apiClient.ts:311-320`) | `sessionStore.hydrate` → `SessionsPage` | ✅ | — | — | — | — |
| /api/v1/session/:id/turns | GET | `handlers/turns.ts:26` | `listSessionTurns` (`apiClient.ts:323-338`) | `SessionDetailPage.tsx:29-42` | ✅ | — | — | — | — |
| /api/v1/export | POST | `handlers/export.ts:12` | `exportBundle` (`apiClient.ts:355-365`) | `ExportBuilder.tsx:78-92` | ⚠️ | Uploaded bundle is built client-side (`buildExportBundle` reads Zustand stores), not the server bundle; server `bundleCounts` ignored | S3 file may not match what server would export | `ExportBuilder.tsx` | S | MEDIUM |
| /api/v1/purge | POST | `handlers/purge.ts:13` | `purge` (`apiClient.ts:368-378`) | `hardPurge.ts:58` → `DestructionKey.tsx` | ✅ | — | — | — | — |
| /api/v1/attachments/presign | POST | `handlers/attachments.ts:76` | `presignMedia` (`apiClient.ts:401-411`) | `attachmentIndex.ts:35-63` (CameraPip/VideoRecorderPip/HoldToTalkOrb) | ✅ | — | — | — | — |
| /api/v1/attachments | POST | `handlers/attachments.ts:116` | `createAttachment` (`apiClient.ts:424-434`) | `attachmentIndex.ts` | ✅ | — | — | — | — |
| /api/v1/attachments | GET | `handlers/attachments.ts:209` | `listAttachments` (`apiClient.ts:437-438`) | **NONE — zero callers** | ❌ | No gallery/list UI; method dead | User cannot view created attachments | new gallery component | S | DEMO-BLOCKER |
| /api/v1/attachments/:id | DELETE | `handlers/attachments.ts:259` | `deleteAttachment` (`apiClient.ts:441-446`) | **NONE — zero callers** | ❌ | No delete UI | Stale media can't be removed | gallery component | S | HIGH |
| /api/v1/metrics | GET | `handlers/health.ts:34` | `metrics` (`apiClient.ts:381-382`) | `MetricsPage.tsx:52-64` | ✅ | — | — | — | — |
| /api/v1/events | POST | `handlers/events.ts:50` | `trackEvent` (`apiClient.ts:385-395`) | `shared/lib/trackEvent.ts` buffer | ✅ | — | — | — | — |
| /api/v1/monetization/cac | GET | `handlers/monetization.ts:37` | **no client method** | **NONE** | ❌ | No monetization UI or client call | CAC invisible | `src/features/metrics/` | M | MEDIUM |
| /api/v1/monetization/summary | GET | `handlers/monetization.ts:48` | **no client method** | **NONE** | ❌ | No MRR/ARR/LTV UI | Business metrics invisible | `src/features/metrics/` | M | MEDIUM |
| /api/v1/analytics/funnel | GET | `handlers/analytics.ts:55` | **no client method** | **NONE** | ❌ | No funnel page | Conversion data unused | new analytics view | M | HIGH |
| /api/v1/analytics/activity | GET | `handlers/analytics.ts:69` | **no client method** | **NONE** | ❌ | No DAU/WAU/MAU UI | Activity data unused | new analytics view | M | HIGH |
| /api/v1/analytics/retention | GET | `handlers/analytics.ts:80` | **no client method** | **NONE** | ❌ | No retention UI | Cohort data unused | new analytics view | M | HIGH |
| /api/v1/health | GET | `handlers/health.ts:10` | `health` (`apiClient.ts:398`) | `OfflineBanner.tsx:16` | ✅ | — | — | — | — |

### Section 2 — SSE / Streaming

Backend `/chat/turn` emits **only `data:` lines** — no `event:` types, no `meta:` field, no `error:` event, no `recalled_titles`, no `tokensUsed`. Verified in `lambda/handlers/chatTurn.ts:157-164`.

| SSE Event Type | Backend emits | Frontend handles | Displayed to user | Status | GAP | EFFORT | PRIORITY |
|---|---|---|---|---|---|---|---|
| `data: {"t":"<line>"}` (per content line) | ✅ `chatTurn.ts:158-160` | ✅ `llmClient.ts:255-265` (appends to bubble) | ✅ | ✅ | — | — | — |
| `data: {"t":"","injectedMemoryIds":[...]}` (final) | ✅ `chatTurn.ts:162-164` | ❌ both parsers read `json.t` only; empty `t` → ignored | ❌ | ⚠️ | Memory injection evidence dropped | XS | DEMO-BLOCKER |
| `data: [DONE]` | ✅ `chatTurn.ts:164` | ✅ `llmClient.ts:246-254` → `finishStream` | ✅ | ✅ | — | — | — |
| SSE error on invalid body (HTTP 400, SSE body) | ✅ `chatTurn.ts:68-75` | ⚠️ HTTP != ok → generic `Error("API 400: ...")` (`apiClient.ts:205`) → generic LLM-unavailable text | ⚠️ generic message, actual reason lost | ⚠️ | Error text not surfaced | XS | MEDIUM |
| SSE error on runtime failure (HTTP 200, SSE body) | ✅ `chatTurn.ts:171-183` | ⚠️ the `{"t":"Terjadi kendala teknis…"}` line IS streamed as if it were assistant content | ⚠️ user sees fake assistant reply | ⚠️ | Error styled as normal reply | XS | HIGH |
| `meta.injectedMemoryIds` (as a separate `meta` field) | ❌ backend has no `meta:` field | ❌ | ❌ | ❌ | No meta event contract | — | — |
| `meta.recalled_titles` (as SSE field) | ❌ backend never emits it (span attr only, `chatTurn.ts:90`) | ❌ zero references in `src/` | ❌ | ❌ | Recall titles invisible | S | DEMO-BLOCKER |
| Stream reconnection | ❌ no retry/backoff | ❌ `resumeStream` (`chatStore.ts:339-374`) issues a **new** call with "Continue your previous response…" | ❌ | ❌ | Dropped connection = truncated reply, no recovery | S | MEDIUM |
| Stream abort on user cancel | ❌ backend buffers entire stream before writing (`chatTurn.ts:132-139`) | ❌ **no `AbortController` anywhere in `src/`**; `bargeIn`/`hardHalt` are local state only | ❌ | ❌ | "Stop" doesn't stop the request; tokens wasted | S | HIGH |

### Section 3 — Memory Features

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| UI to CREATE memory node manually | ✅ | `AddMemoryModal.tsx` → `addNode` → `upsertMemory` | — | — | — |
| READ: all fields displayed | ✅ | `GraphNodeCard.tsx` (kind, weight, confidence, verified, ref_count "recalled {n}×", last_touched) + `NodeInspector.tsx:79-103` | — | — | — |
| UPDATE memory node (edit text) | ✅ | `NodeInspector.tsx:136-160` inline edit → `updateNode` → upsert | — | — | — |
| DELETE memory node | ✅ | `GraphCanvas` PurgeZone / Delete key / `NodeInspector` burn → `deleteMemory` | — | — | — |
| DELETE memory edge | ✅ | `NodeInspector.tsx:123-125` Link2Off → `deleteMemoryEdge` | — | — | — |
| HARD PURGE confirmation flow E2E | ✅ | `DestructionKey.tsx` (type + drag + hold 3s) → `hardPurge.ts:35-93` → `apiClient.purge` | ⚠️ **leak:** `CBT_KEYS` allowlist (`hardPurge.ts:18-24`) omits `cbt-metrics` and `cbt-memory-agent-device-id` — 48 counters + device id survive purge | XS | HIGH |
| Memory graph reflects real backend data | ✅ | `hydrate()` replaces seeds with `GET /memory`; fail-closed (`memoryStore.ts:204-215`) | — | — | — |
| Semantic search surfaced as user action | ✅ | `MemoryPage.tsx:80-89` debounced search → `searchMemory` | — | — | — |
| Memory kinds handled | ✅ | `memory/types.ts:1` = `core|transcript|attachment`; backend CHECK matches | — | — | — |
| verified vs unverified visually distinct | ✅ | `Unverified` badge (`GraphNodeCard.tsx:75-79`) + inspector text/bar | — | — | — |
| ref_count displayed | ✅ | `NodeInspector.tsx:81` "recalled {n}×" | — | — | — |
| confidence displayed | ✅ | `NodeInspector.tsx:79-93` bar + threshold note | — | — | — |

### Section 4 — Sessions

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| Session list from backend (not local-only) | ✅ | `sessionStore.hydrate` → `GET /sessions`; fail-closed empty + retry | — | — | — |
| Session timeline backed by real turns | ✅ | `SessionDetailPage.tsx:29-42` → `GET /session/:id/turns`; loading/error/empty states (`:104-111`) | — | — | — |
| Session compare pulls real data | ⚠️ | `CompareModal.tsx` reads local `compare:[string,string]` ids from the store; no turn-level fetch; local-only | Compare shows session metadata from store, not fetched detail | S | MEDIUM |
| Turn-level data with timestamps | ✅ | `SessionDetailPage.tsx:128-133` role + `formatClock` + "Recalled N memories" | — | — | — |
| Session creation | ✅ | Auto via "End session" (`ChatSafetyHeader.tsx:31-48` → `addSession` → `POST /session`) | — | — | — |
| Session naming/editing | ⚠️ | No rename/edit UI; title fixed at creation | Sessions can't be retitled | S | LOW |

### Section 5 — Analytics & Metrics

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| `/metrics` shown in frontend | ✅ | `MetricsPage.tsx:52-64` → `apiClient.metrics`; real server payload rendered (`:98-166`) | — | — | — |
| Funnel rendered | ❌ | **No `src/features/analytics/` exists**; backend `GET /analytics/funnel` never called | Conversion funnel invisible | M | HIGH |
| Activity rendered | ❌ | Backend `GET /analytics/activity` never called | DAU/WAU/MAU invisible | M | HIGH |
| Retention rendered | ❌ | Backend `GET /analytics/retention` never called | Cohorts invisible | M | HIGH |
| Charts backed by real API | ⚠️ | `MoodSparkline.tsx`/`KpiCard` computed from **local** sessions store, labeled "local only" | Charts are local, not server truth | S | MEDIUM |
| Events fired by frontend | ✅ | 24 events in `telemetryEvents.ts:14-46`, sent via buffered `trackEvent.ts` | — | — | — |
| Monetization events fired | ❌ | `checkout_*`, `payment_*`, `subscription_*` never emitted — no checkout UI exists | Payment funnels dead | M | LOW |

### Section 6 — Export

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| Full flow: trigger → s3Url → download | ✅ | `ExportBuilder.tsx:78-92` → `apiClient.exportBundle` → `window.open(s3Url, "_blank")` | — | — | — |
| Presigned URL opened automatically | ✅ | `window.open` (`ExportBuilder.tsx:88`) | — | — | — |
| Export progress shown | ⚠️ | `uploading` spinner only; no percent/progress | Fine for JSON; no progress for large bundles | XS | LOW |
| Export error handled | ✅ | catch → toast "Server export unavailable — local JSON still works" (`exportBundle.ts:81-84`) | — | — | — |
| What is in the bundle communicated | ⚠️ | Crate chips (Chat/Mood/Memory) communicate intent; but **uploaded bundle is built client-side from Zustand stores** (`buildExportBundle`), not the server-side bundle the API produces | S3 file ≠ server export; `bundleCounts` ignored | S | MEDIUM |
| (reverse) Server bundle vs client bundle | 🔧 | Client builds its own JSON; server `POST /export` also builds one; the client's `buildExportBundle` is a parallel implementation that can drift | Two sources of truth for "your data" | S | MEDIUM |

### Section 7 — Auth

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| Magic link full flow | ✅ | `MagicLinkForm.tsx:20-40` → `issueMagicLink` → dev-mode preview (`:56-80`); `AuthCallbackPage.tsx` → `consumeMagicLink` → `sessionToken` stored | — | — | — |
| Passkey `navigator.credentials.get` called | ❌ | Only `credentials.create` exists (`passkey.ts:13-54`); zero `credentials.get` hits | No passkey sign-in; every "sign in" mints a new profile | S | HIGH |
| Legacy device-id fallback visible | ✅ | `passkey.ts:56-60` + copy in `PasskeyPanel.tsx:62,76-79` | — | — | — |
| Session expiry detected + redirect | ❌ | `magicTokenExpiresAt` never read (`authStore.ts:101`); no expiry check; no 401 redirect | Expired sessions leave user in broken authenticated state | S | HIGH |
| Token refresh | ❌ | Not implemented (session token is static) | Long sessions never re-validate | S | LOW |
| Logout clears all local state | ⚠️ | `signOut` (`authStore.ts:202-210`) clears auth only; memory/sessions/chat/audit/metrics/BYOK survive (require hard purge) | Logout ≠ privacy wipe; next user sees prior user's graph until purge | S | HIGH |

### Section 8 — Crisis Features

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| On-device scoring wired to chat input real-time | ✅ | `detectCrisis.ts:6-25` in `sendMessage` (`chatStore.ts:152-189`); `CrisisFusionBridge.tsx:29-55` 500ms fusion (text 0.5/prosody 0.3/face 0.2, >0.7) | — | — | — |
| Crisis UI triggered automatically vs manual | ⚠️ | Overlay auto-triggers on fusion >0.7; breathing/grounding/binaural are **manual-only** user gestures | Calming tools require user initiation | S | MEDIUM |
| Crisis state persisted/logged to backend | ❌ | Only **local** audit store (`CrisisOverlay.tsx:36,140`) + telemetry; nothing writes `audit_events` → `/metrics` `crisisEvents` always 0 | No server-side crisis record | S | HIGH |
| Emergency contact / swipe-to-call actually initiates | ✅ | `SwipeToCall.tsx:32-41` `window.location.href="tel:…"`; emergency contact `tel:` (`CrisisOverlay.tsx:111-119`) | — | — | — |
| Crisis history view | ❌ | No past-crisis UI; only Metrics `crisisEvents` count (which is 0) | Users can't review past crises | M | MEDIUM |

### Section 9 — Audit Events

Backend-written types (only 2, verified by scanning all `INSERT INTO audit_events`):
`REFLECTION_RAN` (`lambda/lib/reflection.ts:40,320-325`), `CLUSTER_HEALTH_CHECK` (`lambda/lib/clusterHealth.ts:28,121-129`).

Schema-legal but **frontend-local only** (never reach server): `CONSENT_GIVEN, CRISIS_ENGAGED, CRISIS_DISMISSED, SESSION_FINALIZED, MEMORY_VERIFIED, MEMORY_PURGED, EXPORT_MINTED, SESSION_REVOKED, HARD_PURGE, SIGN_OUT`.

| Audit Type | Backend writes | Frontend UI reads/displays | Status | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|---|
| REFLECTION_RAN | ✅ | ❌ | ❌ | Reflection activity invisible to users | M | MEDIUM |
| CLUSTER_HEALTH_CHECK | ✅ | ❌ | ❌ | Cluster health invisible | M | MEDIUM |
| CONSENT_GIVEN (local) | ❌ | ⚠️ `AuditPanel` shows local log | ⚠️ | Local only, not server | S | LOW |
| CRISIS_ENGAGED/DISMISSED (local) | ❌ | ⚠️ `AuditPanel` + never to `/events` | ⚠️ | Crisis never persisted server-side | S | HIGH |
| EXPORT_MINTED / HARD_PURGE (local) | ❌ | ⚠️ local log only | ⚠️ | Audit trail not server-side | S | LOW |
| Admin/debug audit view | — | ❌ | ❌ | No dev-only server audit viewer; `AuditPanel` is local-log only | M | MEDIUM |

### Section 10 — Observability / Telemetry

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| Frontend sends OTel via `/telemetry` | ✅ | `initTelemetry` (`telemetry.ts:51`) + OTLP exporter → `/api/v1/telemetry`; `FetchInstrumentation` auto-spans | — | — | — |
| What errors/events instrumented | ⚠️ | 24 trackEvents + fetch spans + one manual span (`onDeviceLLM.ts:69-108`); but `metric.crashBoundary` dead (`ErrorBoundary.tsx` only `console.error`) | Render crashes not tracked | S | MEDIUM |
| Web Vitals tracked | ❌ | No `web-vitals` package; no PerformanceObserver | No CWV for demo/scorecard | S | HIGH |
| Frontend performance monitoring | ❌ | Only LLM latency; no paint/JS perf | No perf visibility | S | LOW |
| Failed API calls tracked beyond console.warn | ⚠️ | Many fire-and-forget `.catch(console.warn)` (`memoryStore.ts:275,289,308,373`; `chatStore.ts:246-248`; `trackEvent.ts:48-49`); fetch spans auto-created but errors not surfaced as events | API failures invisible in analytics | S | MEDIUM |

### Section 11 — BYOK / Privacy

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| LLM providers selectable in UI | ✅ | `LlmPanel.tsx` + 24-provider catalog `llmRegistry.ts:70-540`; save/revoke/test (`:88-148`) | — | — | — |
| Key storage IndexedDB + WebCrypto E2E | ✅ | `byokKeyManager.ts` AES-GCM, lazy init (`:56`), save/read/revoke/wipe | ⚠️ **finding:** wrapping key is a raw exportable AES key persisted beside ciphertext in the same DB (`:217,229-235`) — vault-lite, not KMS | S | LOW |
| PersonalizedVault real encrypted store | ❌ | It's the onboarding goals form (`PersonalizedVault.tsx`), stored in plaintext in `profile` (localStorage `cbt-memory-agent-auth`); only BYOK keys are encrypted | "Vault" branding overstates encryption | S | MEDIUM |
| Privacy settings user-controllable | ⚠️ | Only theme + consent record + export/purge; session table is **seed data** (`privacyStore.ts:13-38`), `revoke` local-only filter (`privacyStore.ts:47-50`) | "Active sessions" list is fake; revoke does nothing server-side | S | HIGH |
| Data retention setting | ❌ | No retention-period control anywhere | Users can't set data lifespan | S | LOW |

### Section 12 — Error States

| Question | Status | Evidence | GAP / USER IMPACT | EFFORT | PRIORITY |
|---|---|---|---|---|---|
| Per-API error state exists | ⚠️ | Hydrates + page fetches have states; but fire-and-forget sync (`memoryStore`, `sessionStore`, `chatTurn`, `trackEvent`, export/purge libs) use `.catch(console.warn)` | Silent write failures | S | MEDIUM |
| Network errors handled gracefully | ⚠️ | `OfflineBanner` polls `/health` (`:43-55`); but no per-call timeout/retry | Timeouts surface as generic errors | S | MEDIUM |
| 401 caught + redirect to login | ❌ | No interceptor; `apiClient.ts:40-43` throws generic error | Broken auth state persists | XS | HIGH |
| 429 shown with meaningful message | ❌ | Falls into generic error path | No rate-limit UX | XS | HIGH |
| 500 shown with retry | ⚠️ | `BackendSyncStatus` has Retry for hydrates; other 500s = banner without retry | Manual reload needed | S | MEDIUM |
| Global error boundary | ✅ | `shared/ui/ErrorBoundary.tsx:11-44` wraps router (`App.tsx:7-9`) + "Reload workspace" | — | — | — |
| Errors logged to observability | ⚠️ | Fetch spans auto-created; `crashBoundary` metric dead; console.warn pervasive | No aggregated error count | S | MEDIUM |

## Backend Capabilities Completely Dark to Users

1. **Attachment gallery** — `GET /attachments` and `DELETE /attachments/:id` are fully implemented and live-verified, but no component calls them. Users can create media attachments (camera/video/voice) but can never view or delete them from the UI.
2. **Analytics funnel** — `GET /api/v1/analytics/funnel` computes signup→onboarding→message→session conversion; no UI exists.
3. **Analytics activity** — `GET /api/v1/analytics/activity` returns DAU/WAU/MAU + sticky factor; no UI exists.
4. **Analytics retention** — `GET /api/v1/analytics/retention` returns 6-month cohorts; no UI exists.
5. **Monetization CAC** — `GET /api/v1/monetization/cac` computes spend / new-paying-users; no UI exists.
6. **Monetization summary** — `GET /api/v1/monetization/summary` returns MRR/ARR/ARPU/LTV/LTV:CAC; no UI exists.
7. **Server audit events** — `REFLECTION_RAN` and `CLUSTER_HEALTH_CHECK` are written to `audit_events` every 6h but appear nowhere in the UI.
8. **SSE memory-injection evidence** — the final `{"t":"","injectedMemoryIds":[...]}` SSE event is dropped by the parser; the agent's memory recall is invisible during the demo's key moment.
9. **Recall titles** — `memory.recalled_titles` exists only as an OTel span attribute; never surfaced to the user.

## Frontend UI with No Backend Backing

1. **Crisis audit events** — `CRISIS_ENGAGED`/`CRISIS_DISMISSED` are logged to a **local** audit store and bumped in local metrics, but never sent to the server; the backend `/metrics` `crisisEvents` north-star count is therefore **always 0**. Users think crisis engagement is being recorded; it isn't server-side.
2. **"Active sessions" table** — `SessionTable.tsx` renders `seedDevices` ("This browser / Clinic iPad / Shared workstation") from `privacyStore.ts:13-38`; "Revoke" is a local filter only. There is no backend session list — the table is fake.
3. **Chat transcript** — `chatStore` seeds 3 demo messages (`chatStore.ts:57-85`) and is never hydrated from `chat_turns`. Users see canned content and lose their conversation on reload.
4. **Client-side export bundle** — `ExportBuilder` uploads a bundle built client-side from Zustand stores rather than the server's export; the server `bundleCounts` are ignored.
5. **`crisisEvents` metric** — metrics page shows a north-star card backed by a query that always returns 0 because no backend writes the crisis audit types.
6. **PersonalizedVault branding** — advertised as an encrypted vault; in reality it's a plaintext goals form in localStorage.

## Recommended Fix Order

### Before demo recording (DEMO-BLOCKER, XS/S effort)
1. **Consume the `injectedMemoryIds` SSE event** (`llmClient.ts` + `chatStore.ts`): store the IDs, render "Recalled N memories" chip on the assistant bubble. *XS.*
2. **Surface recall evidence in-stream** — add `recalledTitles` to the SSE contract (`chatTurn.ts`) + render. *S.*
3. **Hydrate chat from backend** — load `GET /session/:id/turns` for the active session on open; stop seeding demo messages. *S.*
4. **Add attachment gallery** — call `GET /attachments` + render list; wire `DELETE /attachments/:id`. *S.*

### Before submission (HIGH, S/M effort)
1. **AbortController** for chat stream (`llmClient.ts` + `chatStore.ts`) so barge-in/hard-halt actually cancel. *S.*
2. **Passkey authentication** — add `navigator.credentials.get` to `passkey.ts`. *S.*
3. **401 interceptor + session expiry** in `apiClient.ts` → redirect `/auth`. *XS.*
4. **Crisis events → server** — send `CRISIS_ENGAGED`/`CRISIS_DISMISSED` via `/events` so `crisisEvents` metric becomes real. *S.*
5. **Fix hard-purge leak** — include `cbt-metrics` + device-id in `CBT_KEYS`. *XS.*
6. **Web Vitals** — add `web-vitals` + PerformanceObserver to `telemetry.ts`. *S.*
7. **Logout clears app state** — reset memory/sessions/chat stores on sign-out (or document that hard purge is required). *S.*
8. **Analytics pages (funnel/activity/retention)** — at minimum a tabbed MetricsPage section. *M.*

### Post-hackathon (MEDIUM/LOW or L effort)
1. **Monetization dashboard** (CAC, MRR, ARPU, LTV) — new page. *M.*
2. **Server audit debug view** — read `audit_events` (REFLECTION_RAN, CLUSTER_HEALTH_CHECK). *M.*
3. **Session rename** — add `title` edit + `POST /session`. *S.*
4. **Compare from real turns** — fetch both sessions' turns in `CompareModal`. *S.*
5. **Real "active sessions"** — backend session-token list endpoint + honest UI. *L.*
6. **Retention setting** + real encrypted vault (separate wrapping key / WebCrypto key wrap). *S.*
7. **Streaming un-buffer** — make `/chat/turn` flush SSE incrementally instead of buffering the full OpenRouter stream. *L.*
8. **Per-call error tracking** — replace `.catch(console.warn)` with a central `reportError()` feeding `/events`. *S.*

## Component Responsibility Map

| Gap | File to change | Type of change |
|---|---|---|
| Consume `injectedMemoryIds` SSE event | `src/shared/lib/llmClient.ts`, `src/features/chat/store/chatStore.ts`, `src/features/chat/components/ChatBubble.tsx` | Parse + store + render chip |
| Surface recall titles | `lambda/handlers/chatTurn.ts` (SSE) + `src/shared/lib/llmClient.ts`, `ChatBubble.tsx` | Emit + render |
| Hydrate chat from backend | `src/features/chat/store/chatStore.ts` (+ `apiClient.listSessionTurns`), remove `seedMessages` | New hydrate/persist |
| Attachment gallery | `src/features/chat/` or `src/features/memory/` new component; wire `apiClient.listAttachments`/`deleteAttachment` | New UI |
| AbortController for stream | `src/shared/lib/llmClient.ts`, `src/features/chat/store/chatStore.ts` (`bargeIn`/`hardHalt`) | Real cancellation |
| Passkey auth | `src/features/auth/lib/passkey.ts`, `PasskeyPanel.tsx` | Add `credentials.get` |
| 401/expiry handling | `src/shared/lib/apiClient.ts`, `src/features/auth/store/authStore.ts` | Interceptor + redirect |
| Crisis server events | `src/features/crisis/components/CrisisOverlay.tsx`, `src/shared/lib/trackEvent.ts` | Emit `/events` crisis types |
| Hard-purge leak | `src/features/privacy/lib/hardPurge.ts` (`CBT_KEYS`) | Add keys |
| Web Vitals | `src/shared/lib/telemetry.ts`, `package.json` | Add `web-vitals` |
| Logout state reset | `src/features/auth/store/authStore.ts` `signOut`, `shared/store/*` | Wipe persisted stores |
| Analytics pages | `src/features/metrics/pages/MetricsPage.tsx` or new `src/features/analytics/` | New UI + client methods |
| Monetization dashboard | `src/features/metrics/` new page | New UI + client methods |
| Server audit viewer | `src/features/privacy/components/AuditPanel.tsx` | Read `/audit` (new backend route) or `/metrics` audit |
| Session rename | `src/features/sessions/components/*`, `apiClient.saveSession` | Edit title |
| Real device sessions | `privacyStore.ts`, new backend endpoint | Backend + honest UI |
| Retention setting | `src/features/privacy/components/*` | New control + persistence |
| Per-call error tracking | all fire-and-forget call sites → central `src/shared/lib/reportError.ts` | Replace console.warn |
