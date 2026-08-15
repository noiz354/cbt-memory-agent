# Audit Docs — 2026-08-15

Audit of **CBT Memory Agent** (`main`, live backend via Vite proxy at `localhost:5173`, Lambda `cbt-memory-agent` in `ap-southeast-3`,
CockroachDB cluster `woozy-grivet`, OpenRouter). `typecheck` passes.

| Doc | Content |
|---|---|
| [`AUDIT.md`](./AUDIT.md) | Feature-by-feature audit: what is REAL / PARTIAL / STUB / DEAD / BROKEN / FAKE across chat, sessions, memory, auth, crisis, privacy + Lambda stubs. |
| [`WEB-QUALITY-AUDIT.md`](./WEB-QUALITY-AUDIT.md) | Lighthouse 13.4.1 audit: scores per page, Core Web Vitals, accessibility/SEO details, prioritized fixes. |
| [`SECURITY-AUDIT.md`](./SECURITY-AUDIT.md) | Security & hardening: authN/authZ (backend accepts any token), persist rehydration bug, privacy-claim mismatch, data-at-rest, remediation. |
| [`ADDY-OSMANI-SKILLS.md`](./ADDY-OSMANI-SKILLS.md) | Ringkasan 30 skill Addy Osmani (agent-skills + web-quality-skills) yang terinstall di `~/.agents/skills/`. |

## Headline findings

1. **LLM chat is broken in the UI** — `callOnDeviceLLM` never throws and never fires `onStream`, so the fallback chain
   short-circuits at the placeholder and `isStreaming` hangs forever (AUDIT.md §1.1).
2. **Auth is simulated** — frontend `profile.id` (`Math.random()`-based) is sent as the bearer token and the backend accepts
   **any non-empty token** (SECURITY-AUDIT.md §2.1-2.2).
3. **Session persistence is dead across reloads** — `createVersionedPersist`'s `{version,data}` wrapper is never unpacked by
   zustand's default merge; auth resets to `anonymous` on every reload (AUDIT.md §4.8).
4. **Magic-link double-consume** shows "Link not valid" even when authenticated — the known manual workaround is
   "Return to sign in" (AUDIT.md §4.9).
5. **Accessibility is blocked by contrast** — `text-white/40` 11px text on the dark sidebar fails 4.5:1 on every authenticated
   page (a11y 90–96); fixing it lifts all pages to ≈98+ (WEB-QUALITY-AUDIT.md §3.2).
6. **Privacy claims are false** — UI says "never leaves this device" while turns/memories/sessions are uploaded to CRDB/AWS,
   and hard purge leaves IndexedDB BYOK keys + all server rows behind (SECURITY-AUDIT.md §2.2, §2.6).

## Verification artifacts

- Live backend health: `{"status":"ok","crdb":"connected","llm":"available","s3":"available"}`.
- Auth + onboarding flow driven end-to-end via puppeteer (magic link → consent slider → goal chip → workspace).
- Lighthouse reports (raw JSON): `/tmp/opencode/lh-audit/reports/*.json` (not committed).
- Audit driver script: `/tmp/opencode/lh-audit/audit7.mjs` (not committed).
