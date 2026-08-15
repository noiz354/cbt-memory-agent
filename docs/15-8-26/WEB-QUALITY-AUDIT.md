# Web Quality Audit — CBT Memory Agent

> Audit date: 2026-08-15 · Tool: Lighthouse 13.4.1 (via puppeteer-core 25.7.0, Chrome 145)
> Method: SPA-driven audit. Public `/auth` in **navigation** mode (full load metrics). Authenticated pages in **snapshot** mode
> (auth+onboarding completed in-page, then `lighthouse` `snapshot()` reused on the same page — a reload resets the session, see AUDIT.md §4.8/§4.9).
> Throttling: RTT 40ms, 10 Mbps down, 1× CPU · Form factor: **desktop** · Dev server: `npm run dev` at `localhost:5173`.
> Raw JSON: `/tmp/opencode/lh-audit/reports/*.json` (not in repo).
>
> **Status note (2026-08-15, same session):** the fix table in §7 has been acted on (contrast bumps, aria-labels, `public/robots.txt`
> added). Scores below are the **pre-fix** measurements; a re-run is needed to confirm the delta.

**Caveat:** performance numbers below were measured against the **Vite dev server** (unminified, 138 separate script requests,
HMR client, `@react-refresh`). They are NOT representative of a production build. The `robots.txt` and `bf-cache` failures are
also dev-server artifacts (no `robots.txt` served by Vite in dev; Vite HMR uses WebSocket which blocks bfcache). Re-run against
`npm run build` + `vite preview` (or the deployed bundle) before treating any perf/SEO number as final.

---

## 1. Score summary

| Page | Mode | Performance | Accessibility | Best Practices | SEO |
|---|---|---|---|---|---|
| `/auth` (public) | navigation | **57** | 92 | 100 | 91 |
| `/chat` (authed) | snapshot | n/a* | 91 | 100 | 80 |
| `/sessions` (authed) | snapshot | n/a* | 90 | 100 | 80 |
| `/memory` (authed) | snapshot | n/a* | 96 | 100 | 80 |
| `/settings/privacy` (authed) | snapshot | n/a* | 95 | 100 | 80 |

\* Snapshot mode has no load event, so the Performance category is not meaningful (score 0) and was excluded.
Only `accessibility`, `best-practices`, `seo` were scored for authenticated pages.

**Best Practices = 100 on all pages.** No mixed-content, no browser-errors, no deprecated APIs, no console errors (a good sign for a React SPA).

**SEO = 80 on all authenticated pages, 91 on /auth.** The recurring deficit is the single `robots-txt` failure (see §4.3) which pulls the whole category down.

---

## 2. Performance — `/auth` (the only page with real load metrics)

### 2.1 Core Web Vitals (measured on dev server)

| Metric | Value | Score | Assessment |
|---|---|---|---|
| FCP | **3.5 s** | 0.03 | very poor |
| LCP | **6.4 s** | 0.03 | very poor |
| Speed Index | 3.6 s | 0.16 | poor |
| TTI | 6.4 s | 0.22 | poor |
| TBT | 70 ms | 0.99 | good |
| CLS | 0 | 1.00 | perfect (no layout shift) |
| Server response | 0 ms | 1.00 | excellent |

- **What is good:** no layout shift (CLS=0), negligible blocking time (TBT=70ms), instant server response, fonts use `preconnect` + `display=swap` (`index.html`).
- **What is bad:** FCP/LCP/TTI all land in the 3.5–6.4 s band because of the giant unminified dev JS payload. This is dominated by dev-mode transfer, not by app logic.

### 2.2 Byte weight (dev server — 143 requests, 6.14 MB total)

| Type | Requests | Transfer |
|---|---|---|
| Script | 138 | **6,206,221 B (5.9 MB)** |
| Font | 2 | 76,380 B (Google Fonts: Inter + Plus Jakarta Sans) |
| Stylesheet | 1 | 1,411 B |
| Document | 1 | 1,398 B |
| Other | 1 | 522 B |
| **Total** | **143** | **6,285,932 B (≈6.29 MB)** |

`total-byte-weight` score 0.5 (threshold 6,139 KiB ≈ exactly at the warning line).

### 2.3 Unused / unminified JavaScript (dev-server, for reference only)

- `unused-javascript`: estimated savings **1,994 KiB**. Top contributors (all dev deps, all loaded eagerly because the SPA imports everything in `main.tsx`):
  - `react-dom_client.js` — 1,005,538 B total, 447,315 B wasted (44%)
  - `react-router-dom.js` — 473,838 B, 409,918 B wasted (87%)
  - `framer-motion.js` — 463,665 B, 376,714 B wasted (81%)
  - `chunk-3BTUK4W7.js` — 481,372 B, 243,966 B wasted (51%)
  - `react-markdown.js` — 185,544 B, 139,562 B wasted (75%)
  - `@dnd-kit/core.js` — 103,583 B, 94,128 B wasted (91%)
- `unminified-javascript`: estimated savings **2,411 KiB** (entirely a dev-mode artifact).

> **Action for production:** these three scores (unused/unminified/total-bytes) will be dramatically better in `vite build` output. Still worth auditing the **production** bundle for route-level code splitting — the current `main.tsx` statically imports all feature modules, so all pages ship to everyone.

### 2.4 Network / rendering

- RTT 20 ms, server latency 40 ms (both fine).
- Main-thread work 0.7 s, boot-up time 0.3 s — modest, dominated by the dev payload.
- Fails surfaced: `network-dependency-tree-insight`, `render-blocking-insight` (informative items; the dev `<script type="module">` graph is the whole tree).

---

## 3. Accessibility (all pages)

### 3.1 Score map

| Page | A11y | Binary failures |
|---|---|---|
| `/auth` | 92 | `color-contrast` |
| `/chat` | 91 | `color-contrast`, `label` |
| `/sessions` | 90 | `color-contrast`, `select-name` |
| `/memory` | 96 | `color-contrast` |
| `/settings/privacy` | 95 | `color-contrast` |

### 3.2 CRITICAL: color-contrast fails on every page

The single largest accessibility problem. Every authenticated page fails `color-contrast` on the **sidebar nav + header labels**
(`text-white/40` and `text-white/45` on a dark slate `#272e3f` background):

```
selector: nav.mt-8 > a.flex > span.min-w-0 > span.block
snippet : <span class="block text-[11px] text-white/40">
fg #7d828c on bg #272e3f  →  ratio 3.51 : 1   (needs 4.5 : 1, at 8.3pt/11px normal weight)
```

Failure counts per page:
- `/chat`: **9** nodes — sidebar sub-labels ("Live CBT stream" etc.), memory-rail excerpt pills, badge pills, `text-white/45` floating hints.
- `/sessions`: **7** nodes — sidebar sub-labels, rail excerpt, `text-teal` header, danger pill button.
- `/memory`: **7** nodes — same sidebar/rail/header pattern.
- `/settings/privacy`: **8** nodes — same + badge pill.
- `/auth`: **3** nodes — `p.font-display.text-teal` uppercase eyebrow labels and a `text-teal` button (teal on light background under 4.5:1).

**Root cause:** tailwind opacity modifiers `text-white/40`, `text-white/45`, `text-teal` (default teal-600?) are used for small
(11px) supporting text. Fix: bump to `text-white/60` (or define a token ≥4.5:1 against `#272e3f`) and ensure teal foregrounds
pass on their backgrounds. This is a one-line-per-occurrence change and would lift a11y to ≈98+ on every page.

### 3.3 `/chat` — `label`: unlabeled file input

```
selector: div.rounded-[1.4rem] > div.flex > label.inline-flex > input.sr-only
snippet : <input accept=".pdf,.txt,application/pdf,text/plain" class="sr-only" multiple="" type="file">
explanation: Element does not have an implicit (wrapped) <label> ... aria-label attribute does not exist or is empty
```

The attachment file input is `sr-only` (visually hidden) inside a `<label>` but Lighthouse cannot associate it because the
visible label element doesn't wrap it textually / lacks `htmlFor` or `aria-label`. **Fix:** add `aria-label="Attach files"` (or an `id` + `<label htmlFor>`).

### 3.4 `/sessions` — `select-name`: unlabeled filter select

```
selector: header.mb-4 > div > div.mt-3 > select.h-9
snippet : <select class="h-9 rounded-xl border border-line bg-white px-2 text-sm">
```

The board filter `<select>` has no `<label>`/`aria-label`/`aria-labelledby`. **Fix:** add `aria-label="Filter sessions by status"` (or a wrapping label).

### 3.5 What passed

No failures for: `aria-*` misuse, buttons names, heading order, image-alt, link names, tap targets, meta viewport, focusable
content, html `lang` (index.html has `lang="en"`), document title, or landmark regions. Contrast is the dominant theme.

---

## 4. SEO (all pages)

| Page | SEO score | Binary failures |
|---|---|---|
| `/auth` | 91 | `robots-txt` |
| `/chat` | 80 | `robots-txt` |
| `/sessions` | 80 | `robots-txt` |
| `/memory` | 80 | `robots-txt` |
| `/settings/privacy` | 80 | `robots-txt` |

### 4.1 Passed (good)
- `meta-description` present and relevant: *"CBT Memory Agent — private, on-device multimodal cognitive therapy workspace."*
- `document-title` present.
- `crawlable-anchors`, `is-crawlable`, `link-text` all pass.
- `viewport` present with `viewport-fit=cover`.

### 4.2 Partial: indexability is fine, but the whole SPA is a single `<div id="root">`
- There is **no SSR/SSG/prerendering**. Search engines execute JS (Google can, in principle), but a therapist-facing local app
  is unlikely to need SEO; if public marketing pages are added later, ship those as static HTML or add `react-helmet`-style per-route `<title>`/meta.

### 4.3 The recurring `robots-txt` failure — dev artifact, but note it
Lighthouse fetches `/robots.txt` and the Vite dev server returns the SPA HTML (`<!doctype html>…`), producing "Syntax not understood" × 29.
- In a production deployment (nginx static serve) a `robots.txt` should be added: `public/robots.txt` → Vite copies it into `dist/`.
- Recommend adding `public/robots.txt` with e.g. `User-agent: * / Disallow:` and a sitemap reference, to clear this on every page.

---

## 5. Best Practices — all 100

- No mixed content, no known vulnerabilities flagged, no browser errors, no deprecated APIs, no invalid attributes.
- `index.html` has `theme-color`, preconnects, and `display=swap` for fonts.
- Note: no `Content-Security-Policy` meta in `index.html` and no security headers on the Lambda `corsHeaders()` beyond CORS
  (see SECURITY-AUDIT.md §3). These are **not** Lighthouse best-practices failures but are worth adding for a clinical app.

---

## 6. Core Web Vitals checklist (web-quality-audit skill thresholds)

| CWV | Threshold | Measured (dev, /auth) | Verdict |
|---|---|---|---|
| LCP | ≤ 2.5 s | 6.4 s | FAIL (dev artifact — re-test on prod build) |
| INP | ≤ 200 ms | TBT 70 ms ≈ INP well under | PASS |
| CLS | ≤ 0.1 | 0 | PASS |

Lighthouse targets (web-quality skill): perf ≥ 90 · a11y = 100 · best-practices ≥ 95 · SEO ≥ 95.
Achieved on dev (pre-fix): perf 57, a11y 90–96, BP 100, SEO 80–91. **After the §7 fixes the remaining real gaps are perf
(dev-server artifact — re-run on a production build) and the still-open optional items (#5–#7).**

---

## 7. Prioritized fixes (web-quality scope)

| # | Priority | Fix | Files (likely) | Effect | Status |
|---|---|---|---|---|---|
| 1 | High | Raise `text-white/40`→`text-white/60`, `text-white/45`→`text-white/60` on 11px supporting text; make teal eyebrow/buttons pass 4.5:1 | `Sidebar.tsx`, `MemoryRail.tsx`, header components, `AuthPage.tsx` | a11y 90–96 → ≈98–100 on all pages | ✅ **DONE** — `text-white/40→/60` (`Sidebar.tsx:56,68`), `text-white/45→/60` (`AuthShell.tsx:31`, `PersonalizedVault.tsx:111`, `CrisisOverlay.tsx:132`, `CameraPip.tsx:119`); teal→`teal-700` (#0f766e, added to `index.css` @theme) on `AuthShell.tsx:60,64` + `MagicLinkForm.tsx:44` |
| 2 | High | `aria-label` on the file input in Composer | `Composer.tsx` / `FileDropzone.tsx` | clears `label` on /chat | ✅ **DONE** — `aria-label="Attach files"` on the file input (`Composer.tsx:97`) |
| 3 | High | `aria-label` on the sessions filter `<select>` | `SessionsPage.tsx` | clears `select-name` on /sessions | ✅ **DONE** — `aria-label="Filter sessions by status"` (`SessionsPage.tsx:103`) |
| 4 | Medium | Add `public/robots.txt` (+ optional sitemap) | new file `public/robots.txt` | clears `robots-txt`, SEO → ≈100 | ✅ **DONE** — `public/robots.txt` (`User-agent: *` / `Disallow:`) |
| 5 | Medium | Re-run audit against production build (`npm run build` + `vite preview`) to get real perf numbers | — | validates CWV | ⬜ open |
| 6 | Low | Evaluate route-level code splitting of `main.tsx` static imports for the prod bundle | `src/main.tsx`, `src/app/router.tsx` | reduces prod JS per page | ⬜ open (verified 2026-08-15: `router.tsx:3-11` masih statik import semua 9 page, nol `React.lazy`) |
| 7 | Low | Consider CSP + security headers (not a Lighthouse failure today) | `index.html`, Lambda `corsHeaders()` | defense-in-depth for clinical data | 🔶 **partial:** nginx sudah set `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, dan full CSP (`nginx.conf:45-49`); yang tersisa: CSP meta `index.html` + headers di Lambda `corsHeaders()` (lihat SECURITY-AUDIT §2.1/§2.5) |

> **After the §7 fixes**, expected delta: a11y on `/chat`/`/sessions`/`/settings` up several points (contrast nodes + 2 labels cleared),
> SEO on every page up from 80/91 → ~100 (`robots-txt` cleared). Perf is unchanged (dev server) until a prod-build re-run (#5).

---

## 8. Reproduction

```bash
npm run dev                       # Vite at localhost:5173 (proxy /api/v1 → Lambda)
node /tmp/opencode/lh-audit/audit7.mjs   # drives auth+onboarding in one page, runs lighthouse snapshot per page
# reports written to /tmp/opencode/lh-audit/reports/*.json
```
