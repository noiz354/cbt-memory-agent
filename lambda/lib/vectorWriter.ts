/**
 * Vector Writer — generate embedding untuk memory node & simpan ke `embeddings`.
 *
 * Dipakai oleh handler memory (upsert user) dan handler reflection (cron),
 * sehingga satu jalur konsisten untuk semua penulisan embedding.
 */

import { CrdbClient } from "./crdb";
import { OpenRouterClient } from "./openrouter";
import { buildEmbeddingChunks, toVectorLiteral } from "./vectors";
import { logger } from "./logger";

export interface EmbeddableNode {
  id: string;
  title: string;
  excerpt?: string | null;
  tags?: string[] | null;
}

/**
 * Generate embedding untuk sebuah memory node dan simpan ke tabel `embeddings`.
 * Best-effort: jika embedding gagal (mis. OpenRouter down), error dicatat tapi
 * TIDAK dilempar — memory node tetap tersimpan.
 *
 * Teks di-embed = title + tags + excerpt (buildEmbeddingChunks); excerpt panjang
 * dipecah menjadi beberapa baris embeddings (text_source `chunk-N`). Selalu hapus
 * embedding lama node dulu (node bisa di-upsert ulang), lalu insert versi baru,
 * sehingga `embeddings` tidak menumpuk versi usang per node. Insert per-chunk
 * (bukan batch) sesuai best practice C-SPANN.
 */
export async function writeNodeEmbedding(
  crdb: CrdbClient,
  llm: OpenRouterClient,
  userId: string,
  node: EmbeddableNode,
): Promise<void> {
  try {
    const chunks = buildEmbeddingChunks(node);
    if (chunks.length === 0) return;

    await crdb.execute(
      `DELETE FROM embeddings WHERE user_id = $1::uuid AND node_id = $2`,
      [userId, node.id],
    );
    for (const chunk of chunks) {
      const embedding = await llm.generateEmbedding(chunk.text.slice(0, 8000));
      const literal = toVectorLiteral(embedding);
      await crdb.execute(
        `INSERT INTO embeddings (user_id, node_id, embedding, text_source)
         VALUES ($1::uuid, $2, $3, $4)`,
        [userId, node.id, literal, chunk.textSource],
      );
    }
  } catch (err) {
    logger.warn("memory.embedding_failed", "Embedding write skipped (best-effort)", {
      err: err instanceof Error ? err.message : String(err),
      nodeId: node.id,
    });
  }
}
