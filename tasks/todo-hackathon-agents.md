# TODO — Hackathon Final Push: 4/4 CockroachDB Tools + Agentic Memory Loop

> Checklist Build → Verify → Review → Ship. Detil di `ADDY-OSMANI-SKILLS.md` (WS-A..WS-E).

## Build

- [x] WS-A: Managed MCP read-only AKTIF — `mcp/mcp-config.json` + `.mcp.json` endpoint managed; bukti live 9 tool di `docs/15-8-26/mcp-proof/`; `docs/MCP-STATUS.md` rewrite
- [x] WS-B: Vendor Agent Skills — `skills/cockroachdb-skills/` (commit e14e86d23ce8, 34 skills); VENDORED.md; validate 0 error; TANPA integrasi runtime (keputusan user)
- [x] WS-C: ccloud CLI — `scripts/ccloud-audit.sh` (6/6 PASS live) + health gate di deploy.yml
- [x] WS-D: Agentic memory loop
  - [x] D1 recall eksplisit (recalledTitles + span + SSE injectedMemoryIds)
  - [x] D2 `lambda/lib/vectorWriter.ts` diekstrak + `OpenRouterClient.chat()`
  - [x] D3 `lambda/lib/reflection.ts` + `lambda/handlers/reflect.ts` + migration audit REFLECTION_RAN
  - [x] D4 Terraform module eventbridge (rule rate 6 jam) + deteksi event scheduled di handler.ts
  - [x] D5 surfacing otomatis via RRF (verified conf filter)
  - [x] D6 `lambda/tests/reflection.test.ts` (12 test)
- [x] WS-E: Submission artifacts — README rewrite (matrix 4/4 + checklist + URL + API status), `docs/ARCHITECTURE.md` (mermaid), `docs/DEMO-SCRIPT.md` (video ≤3 menit), LICENSE MIT sudah ada

## Verify

- [x] `cd lambda && npx tsc --noEmit && npm test` → 99/99 hijau
- [x] `npm run typecheck` (frontend) hijau
- [x] `npx tsx scripts/vector-health-check.ts` live OK (3 user 100%, fulltext idx, EXPLAIN vector search)
- [x] `bash scripts/ccloud-audit.sh --quiet` OK (6/6)
- [x] Terraform apply live: EventBridge rule `cbt-memory-agent-reflect`, Lambda timeout 300s
- [x] Reflection diinvoke live → 3 fact + 3 embedding + 3 audit REFLECTION_RAN, idempoten
- [x] `GET /api/v1/health` live OK

## Review

- [x] ADR-005 (agentic memory loop) + ADR-006 (MCP read-only + vendor skills)
- [x] PROGRESS.md section baru (4/4 tools + agentic loop)

## Ship

- [ ] Commit WS-A..WS-E (satu/beberapa commit bersih, working tree bersih)
- [ ] Rekam video demo ≤3 menit (script `docs/DEMO-SCRIPT.md`) → isi link di README
- [ ] Update PROGRESS.md baris "Sisa: rekam video" setelah video tayang
