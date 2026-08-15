/**
 * Vectors lib — helper untuk embedding vector di CockroachDB.
 *
 * `toVectorLiteral` mengubah array number menjadi literal VECTOR yang dimengerti
 * CockroachDB (sintaks pgvector): `[0.123456,0.234567,...]`.
 * `embeddingText` menyusun teks yang di-embed (title + tags + excerpt).
 * `buildEmbeddingChunks` memecah teks panjang menjadi window 2000 (overlap 100)
 * sehingga excerpt yang panjang ter-representasi sebagai beberapa baris embeddings
 * (text_source `chunk-N`).
 */

export const EMBED_TEXT_SOURCE = "title+excerpt";
export const CHUNK_SIZE = 2000;
export const CHUNK_OVERLAP = 100;

export interface EmbeddableNode {
  title: string;
  excerpt?: string | null;
  tags?: string[] | null;
}

export interface EmbeddingChunk {
  text: string;
  textSource: string;
}

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((v) => v.toFixed(6)).join(",")}]`;
}

export function embeddingText(node: EmbeddableNode): string {
  const tags = (node.tags ?? []).filter(Boolean).join(",");
  const parts = [node.title.trim(), tags, (node.excerpt ?? "").trim()].filter(Boolean);
  return parts.join(" — ");
}

export function buildEmbeddingChunks(node: EmbeddableNode): EmbeddingChunk[] {
  const text = embeddingText(node);
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) {
    return [{ text, textSource: EMBED_TEXT_SOURCE }];
  }

  const chunks: EmbeddingChunk[] = [];
  const step = CHUNK_SIZE - CHUNK_OVERLAP;
  for (let start = 0, i = 0; start < text.length; start += step, i += 1) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    chunks.push({ text: text.slice(start, end), textSource: `chunk-${i}` });
  }
  return chunks;
}
