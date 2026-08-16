import type { ChatMessage } from "@/features/chat/types";

/** Backend shape returned by `GET /session/:id/turns`. */
export interface SyncedTurn {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tokensUsed: number;
  injectedMemoryIds: string[];
  createdAt: string;
}

/**
 * Maps server turns to in-memory `ChatMessage`s for the live stream.
 *
 * `injectedMemoryIds` becomes `recalledMemoryIds` so restored turns keep the
 * "Recalled N memories" evidence chip from the original stream.
 */
export function turnsToMessages(turns: SyncedTurn[]): ChatMessage[] {
  return turns.map((turn) => ({
    id: turn.id,
    role: turn.role,
    content: turn.content,
    createdAt: turn.createdAt,
    ...(turn.injectedMemoryIds.length > 0
      ? { recalledMemoryIds: turn.injectedMemoryIds }
      : {}),
  }));
}
