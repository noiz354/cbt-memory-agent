/**
 * Unit tests — MCP read-only client (lambda/lib/mcp.ts).
 *
 * `fetchExistingCoreFacts`: fetch facts user yang sudah verified via MCP
 * `select_query`. Semua failure (no key, network, timeout, malformed) harus
 * menghasilkan EMPTY_MCP_CONTEXT — TIDAK pernah melempar keluar.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  fetchExistingCoreFacts,
  EMPTY_MCP_CONTEXT,
  MCP_ENDPOINT,
} from "../lib/mcp";

const USER_ID = "11111111-2222-3333-4444-555555555555";
const SSE_BODY = [
  'event: message',
  'data: {"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\\"rows\\":[{\\"title\\":\\"Sleep anxiety\\",\\"excerpt\\":\\"struggles to fall asleep\\"},{\\"title\\":\\"Morning routine\\",\\"excerpt\\":\\"prefers mornings\\"}]}"}]}}',
  "",
].join("\n");

function fakeResponse(text: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    statusText: ok ? "OK" : "Server Error",
    text: async () => text,
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  process.env.CCLOUD_MCP_API_KEY = "test-key";
  delete process.env.MCP_FETCH_TIMEOUT_MS;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.CCLOUD_MCP_API_KEY;
  delete process.env.CCLOUD_API_KEY;
  delete process.env.MCP_FETCH_TIMEOUT_MS;
});

describe("fetchExistingCoreFacts", () => {
  it("returns facts on successful select_query (SSE parse)", async () => {
    globalThis.fetch = vi.fn(async () => fakeResponse(SSE_BODY)) as any;

    const ctx = await fetchExistingCoreFacts(USER_ID);

    expect(ctx.used).toBe(true);
    expect(ctx.factsCount).toBe(2);
    expect(ctx.facts[0].title).toBe("Sleep anxiety");
    expect(ctx.facts[1].excerpt).toBe("prefers mornings");

    // Memanggil endpoint MCP + header auth/cluster
    const [url, init] = (globalThis.fetch as any).mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(MCP_ENDPOINT);
    expect(init.headers["mcp-cluster-id"]).toContain("87275047");
    expect(init.headers["Authorization"]).toBe("Bearer test-key");
  });

  it("truncates and filters blank titles", async () => {
    const body = [
      "data: " + JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                rows: [
                  { title: "A".repeat(120), excerpt: "E" },
                  { title: "   ", excerpt: "blank" },
                  { title: "Valid", excerpt: "ok" },
                ],
              }),
            },
          ],
        },
      }),
      "",
    ].join("\n");
    globalThis.fetch = vi.fn(async () => fakeResponse(body)) as any;

    const ctx = await fetchExistingCoreFacts(USER_ID);

    expect(ctx.factsCount).toBe(2);
    expect(ctx.facts[0].title).toHaveLength(60); // truncated
    expect(ctx.facts.some((f) => f.title === "   ")).toBe(false); // blank dropped
  });

  it("returns EMPTY_MCP_CONTEXT when fetch rejects (network down)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as any;

    const ctx = await fetchExistingCoreFacts(USER_ID);
    expect(ctx).toEqual(EMPTY_MCP_CONTEXT);
  });

  it("returns EMPTY_MCP_CONTEXT on HTTP error", async () => {
    globalThis.fetch = vi.fn(async () => fakeResponse("boom", false)) as any;

    const ctx = await fetchExistingCoreFacts(USER_ID);
    expect(ctx).toEqual(EMPTY_MCP_CONTEXT);
  });

  it("returns EMPTY_MCP_CONTEXT on timeout (AbortSignal fires)", async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted due to timeout", "AbortError"));
          });
        });
      }) as any;

      const pending = fetchExistingCoreFacts(USER_ID);
      await vi.advanceTimersByTimeAsync(6000);
      const ctx = await pending;
      expect(ctx).toEqual(EMPTY_MCP_CONTEXT);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns EMPTY_MCP_CONTEXT without network when no key set", async () => {
    delete process.env.CCLOUD_MCP_API_KEY;
    delete process.env.CCLOUD_API_KEY;
    globalThis.fetch = vi.fn() as any;

    const ctx = await fetchExistingCoreFacts(USER_ID);
    expect(ctx).toEqual(EMPTY_MCP_CONTEXT);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns EMPTY_MCP_CONTEXT for invalid user id (no network)", async () => {
    globalThis.fetch = vi.fn() as any;

    const ctx = await fetchExistingCoreFacts("not-a-uuid");
    expect(ctx).toEqual(EMPTY_MCP_CONTEXT);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
