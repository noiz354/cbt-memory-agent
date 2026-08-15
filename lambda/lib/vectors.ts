/**
 * Vectors lib — helper untuk embedding vector di CockroachDB.
 *
 * `toVectorLiteral` mengubah array number menjadi literal VECTOR yang dimengerti
 * CockroachDB (sintaks pgvector): `[0.123456,0.234567,...]`.
 * `embeddingText` menyusun teks yang di-embed (title + excerpt).
 */

export const EMBED_TEXT_SOURCE = "title+excerpt";

export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.map((v) => v.toFixed(6)).join(",")}]`;
}

export function embeddingText(node: { title: string; excerpt?: string | null }): string {
  const parts = [node.title.trim(), (node.excerpt ?? "").trim()].filter(Boolean);
  return parts.join(" — ");
}
