/**
 * Unit tests — hybrid retrieval (Gap 1+2): Reciprocal Rank Fusion.
 *
 * `reciprocalRankFusion` menggabungkan beberapa ranking (heuristik + vector)
 * berbasis rank (bukan skor mentah) sehingga skala heuristik (weight) dan cosine
 * tidak saling mendominasi.
 */

import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../lib/retrieval";

interface Item {
  id: string;
}

const a: Item = { id: "a" };
const b: Item = { id: "b" };
const c: Item = { id: "c" };
const d: Item = { id: "d" };

describe("reciprocalRankFusion", () => {
  it("fuses single set unchanged (order preserved)", () => {
    expect(reciprocalRankFusion([[a, b, c]])).toEqual([a, b, c]);
  });

  it("boosts items present in multiple sets (rank-based, not score-based)", () => {
    const heuristic = [a, b, c]; // a rank1, b rank2, c rank3
    const vector = [b, a, d]; //    b rank1, a rank2, d rank3
    const fused = reciprocalRankFusion([heuristic, vector]);
    // scores (k=60): a = 1/61 + 1/62 ≈ 0.0325; b = 1/62 + 1/61 ≈ 0.0325; c = 1/63; d = 1/63
    expect(fused[0]).toEqual(a);
    expect(fused[1]).toEqual(b);
    expect(fused).toHaveLength(4);
  });

  it("item ranked high in both beats item ranked high in only one", () => {
    const list1 = [c, b, a]; // c1, b2, a3
    const list2 = [c, a, d]; // c1, a2, d3
    const fused = reciprocalRankFusion([list1, list2]);
    expect(fused[0]).toEqual(c);
  });

  it("respects topN limit", () => {
    const list = [a, b, c, d, a, b];
    expect(reciprocalRankFusion([list], 60, 2)).toHaveLength(2);
  });

  it("deduplicates items appearing in multiple sets", () => {
    const fused = reciprocalRankFusion([[a, b], [b, a]]);
    expect(new Set(fused.map((i) => i.id)).size).toBe(fused.length);
  });

  it("uses stable tie-break by first-seen rank", () => {
    const fused = reciprocalRankFusion([[a, b], [b, a]]);
    expect(fused[0].id).toBe("a");
  });
});
