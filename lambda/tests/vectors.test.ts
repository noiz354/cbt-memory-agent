/**
 * Unit tests — embedding text + chunking (Gap 6).
 *
 * `embeddingText` kini mencakup tags (`title — tags — excerpt`); `buildEmbeddingChunks`
 * memecah teks panjang jadi window 2000 dengan overlap 100 (chunk-N).
 */

import { describe, expect, it } from "vitest";
import {
  buildEmbeddingChunks,
  EMBED_TEXT_SOURCE,
  CHUNK_SIZE,
  CHUNK_OVERLAP,
  embeddingText,
} from "../lib/vectors";

describe("embeddingText — tags + excerpt", () => {
  it("includes tags between title and excerpt", () => {
    expect(
      embeddingText({ title: "Panic attack", tags: ["anxiety", "triggers"], excerpt: "loud noise" }),
    ).toBe("Panic attack — anxiety,triggers — loud noise");
  });

  it("omits empty tags and excerpt", () => {
    expect(embeddingText({ title: "Solo", tags: [], excerpt: null })).toBe("Solo");
  });

  it("keeps backward-compatible shape without tags", () => {
    expect(embeddingText({ title: "A", excerpt: "B" })).toBe("A — B");
  });
});

describe("buildEmbeddingChunks — window 2000 / overlap 100", () => {
  it("returns a single chunk with title+excerpt source for short text", () => {
    const chunks = buildEmbeddingChunks({ title: "Short", excerpt: "note" });
    expect(chunks).toEqual([{ text: "Short — note", textSource: EMBED_TEXT_SOURCE }]);
  });

  it("returns no chunks for empty text", () => {
    expect(buildEmbeddingChunks({ title: "   ", excerpt: "  " })).toEqual([]);
  });

  it("splits long text into sequential chunk-N windows with overlap", () => {
    const long = "x".repeat(CHUNK_SIZE + CHUNK_OVERLAP + 50);
    const chunks = buildEmbeddingChunks({ title: "T", excerpt: long });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].textSource).toBe("chunk-0");
    expect(chunks[1].textSource).toBe("chunk-1");
    expect(chunks[0].text.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(chunks[1].text.length).toBeLessThanOrEqual(CHUNK_SIZE);
    expect(chunks[0].text.slice(-CHUNK_OVERLAP)).toBe(chunks[1].text.slice(0, CHUNK_OVERLAP));
  });

  it("reconstructs full text when joining chunks with overlap step", () => {
    const body = "y".repeat(CHUNK_SIZE + CHUNK_OVERLAP * 2 + 10);
    const chunks = buildEmbeddingChunks({ title: "", excerpt: body });
    const joined = chunks.map((c) => c.text).join("");
    expect(joined.length).toBeGreaterThanOrEqual(body.length);
  });
});
