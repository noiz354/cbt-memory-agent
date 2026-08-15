/**
 * Retrieval lib — hybrid retrieval (Gap 1+2): Reciprocal Rank Fusion.
 *
 * `reciprocalRankFusion` menggabungkan beberapa ranking (mis. hasil heuristik
 * `weight/last_touched` dan hasil vector cosine) berbasis rank, bukan skor mentah,
 * sehingga skala heuristik dan cosine tidak saling mendominasi. Rank berasosiasi
 * stabilitas (k = 60); item yang relevan di BANYAK set mendapat skor gabungan.
 */

export const RRF_K = 60;

/**
 * Gabungkan beberapa daftar ranking menjadi satu daftar fusion.
 *
 * - Rank dihitung 1-indexed per set.
 * - Skor item = Σ 1/(k + rank) di setiap set tempat ia muncul.
 * - Dedup otomatis (item yang muncul di beberapa set tetap satu entri).
 * - Tie-break stabil: urutan kemunculan pertama (first-seen) di seluruh input.
 * - Hasil dipotong ke `topN`.
 */
export function reciprocalRankFusion<T extends { id: string }>(
  sets: T[][],
  k = RRF_K,
  topN = 8,
): T[] {
  const score = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  const itemById = new Map<string, T>();
  let order = 0;

  for (const set of sets) {
    for (let i = 0; i < set.length; i += 1) {
      const item = set[i];
      if (!firstSeen.has(item.id)) {
        firstSeen.set(item.id, order);
        order += 1;
      }
      itemById.set(item.id, item);
      const rank = i + 1;
      score.set(item.id, (score.get(item.id) ?? 0) + 1 / (k + rank));
    }
  }

  return [...score.keys()]
    .sort((x, y) => {
      const byScore = (score.get(y) ?? 0) - (score.get(x) ?? 0);
      if (byScore !== 0) return byScore;
      return (firstSeen.get(x) ?? 0) - (firstSeen.get(y) ?? 0);
    })
    .slice(0, topN)
    .map((id) => itemById.get(id)!);
}
