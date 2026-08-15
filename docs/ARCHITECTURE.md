# Architecture — CBT Memory Agent × CockroachDB × AWS

> Dokumen ini adalah **artefak submission** (requirement: optional architecture diagram).
> Diagram mermaid dapat dirender di GitHub atau `mermaid.live`. Status: 2026-08-16.

## High-level overview

```mermaid
flowchart TB
    subgraph Client["Client device (on-device, private)"]
        FE["React 19 + Vite frontend<br/>Zustand stores · offline-first"]
        ON["On-device processing<br/>VAD · audio · face · crisis regex"]
    end

    subgraph AWS["AWS (ap-southeast-3)"]
        LB["AWS Lambda · Node 22<br/>Function URL + auth middleware"]
        EB["Amazon EventBridge<br/>schedule rate(6 hours)"]
        CW["CloudWatch Logs + Dashboard"]
        S3["S3 export bucket<br/>(cbt-memory-exports)"]
    end

    subgraph CRDB["CockroachDB Cloud (woozy-grivet, Serverless)"]
        DB[(memory_nodes · memory_edges · embeddings<br/>chat_turns · sessions · users · audit_events · user_events)]
        VIDX["Vector index<br/>embeddings_vector_idx<br/>(user_id, embedding vector_cosine_ops)"]
        FTIDX["Fulltext inverted index<br/>memory_nodes_search_idx"]
    end

    subgraph LLM["OpenRouter"]
        CHAT["LLM chat (streaming)"]
        EMB["embeddings bge-m3 (1024d)"]
    end

    subgraph TOOL["Agent tooling (dev / triage, read-only)"]
        MCP["CockroachDB Cloud Managed MCP<br/>https://cockroachlabs.cloud/mcp"]
        CCLOUD["ccloud CLI"]
        SKILLS["Agent Skills repo<br/>(vendored, 34 skills)"]
    end

    FE -->|HTTPS /api/v1| LB
    ON --> FE
    LB --> DB
    LB --> CHAT
    LB --> EMB
    LB --> S3
    EB -->|"{source: agent.memory, detail-type: reflect}"| LB
    LB -.-> CW
    DB --- VIDX
    DB --- FTIDX
    MCP -.-> DB
    CCLOUD -.-> DB
    SKILLS -.-> MCP
```

## Request path — chat turn (agentic memory loop)

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant L as Lambda
    participant O as OpenRouter
    participant C as CockroachDB

    U->>F: send message
    F->>L: POST /api/v1/chat/turn (SSE)
    L->>C: getMemoryContext (3-set RRF, k=60, top 8)
    Note over C: 1) heuristic (weight) · 2) fulltext to_tsvector · 3) vector (C-SPANN)
    C-->>L: fused memories + recalled_titles
    L->>O: streamChat (system prompt + memories + transcript)
    O-->>F: SSE deltas
    L->>C: INSERT chat_turns + upsert transcript memory
    L-->>F: SSE meta event { t:'', injectedMemoryIds:[...] }
    F->>F: render answer (meta event not rendered)
```

## Scheduled reflection job (EventBridge)

```mermaid
sequenceDiagram
    participant EB as EventBridge (rate 6h)
    participant L as Lambda (reflect.ts)
    participant O as OpenRouter
    participant C as CockroachDB

    EB->>L: {source: agent.memory, detail-type: reflect}
    L->>C: SELECT DISTINCT user_id FROM chat_turns (last 7 days)
    loop per active user
        L->>C: SELECT last 20 turns (chronological)
        L->>O: chat() non-streaming — extract durable facts (max 8, no PII)
        L->>C: upsert memory_nodes kind=core verified=true (deterministic md5 id, ref_count+1)
        L->>C: writeNodeEmbedding → embeddings
        L->>C: INSERT audit_events type=REFLECTION_RAN
    end
    L-->>EB: { v:1, ok:true, userFacts, errors, skipped }
    Note over L,C: Facts surface automatically in future turns:<br/>getMemoryContext filters verified=true AND confidence>=0.6
```

## Security boundaries

- **Read vs write**: Lambda data-plane is the only writer (pg Pool, auth middleware).
  Managed MCP is read-only agent tooling — never wired into Lambda runtime.
- **Zero PII in LLM prompts**: name/email/phone never sent to OpenRouter; reflection
  prompt explicitly forbids PII extraction.
- **BYOK on device**: API keys encrypted in IndexedDB + WebCrypto; never leave device.
- **Audit**: every mutation recorded in `audit_events` (including `REFLECTION_RAN`).
- **Spend limit**: cluster serverless spend_limit $0.00; OpenRouter daily cap via SSM.

## Tooling map (submission matrix)

| Category | Tool | Live proof |
|---|---|---|
| CRDB tool 1 | Cloud Managed MCP (read-only) | `docs/15-8-26/mcp-proof/` |
| CRDB tool 2 | Distributed Vector Indexing (C-SPANN + fulltext) | `embeddings_vector_idx`, `memory_nodes_search_idx` |
| CRDB tool 3 | ccloud CLI (provision + audit) | `scripts/ccloud-audit.sh` (6/6 PASS) |
| CRDB tool 4 | Agent Skills repo (vendored) | `skills/cockroachdb-skills/` |
| AWS 1 | Lambda | Function URL live (`/api/v1/health` OK) |
| AWS 2 | S3 | `cbt-memory-exports` |
| AWS 3 | EventBridge | `cbt-memory-agent-reflect` rule |
| AWS 4 | CloudWatch | Logs + dashboard + health gate |
| LLM | OpenRouter | chat + embeddings |

## Deployment

```text
GitHub Actions (deploy.yml)
  → lambda: npx tsc --noEmit + npm test (99 tests)
  → ccloud-audit.sh --quiet (health gate)
  → build-lambda.sh → zip
  → terraform init/apply (TF_VAR_* secrets from GitHub secrets)
  → health curl

Terraform modules: apigw, budget, eventbridge, iam, lambda, ssm
Backend: S3 bucket cbt-memory-agent-terraform-state-apse3
```
