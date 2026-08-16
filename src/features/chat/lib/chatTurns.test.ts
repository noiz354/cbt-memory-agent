import { describe, expect, it } from "vitest";
import { turnsToMessages, type SyncedTurn } from "./chatTurns";

const turns: SyncedTurn[] = [
  {
    id: "t1",
    role: "user",
    content: "Hello",
    tokensUsed: 0,
    injectedMemoryIds: [],
    createdAt: "2026-08-16T08:00:00.000Z",
  },
  {
    id: "t2",
    role: "assistant",
    content: "Hi there",
    tokensUsed: 120,
    injectedMemoryIds: ["mem-1", "mem-2"],
    createdAt: "2026-08-16T08:00:05.000Z",
  },
];

describe("turnsToMessages", () => {
  it("maps every turn to a ChatMessage preserving id/role/content/createdAt", () => {
    const messages = turnsToMessages(turns);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "t1",
      role: "user",
      content: "Hello",
      createdAt: "2026-08-16T08:00:00.000Z",
    });
  });

  it("carries injectedMemoryIds over as recalledMemoryIds", () => {
    const messages = turnsToMessages(turns);
    expect(messages[1].recalledMemoryIds).toEqual(["mem-1", "mem-2"]);
  });

  it("omits recalledMemoryIds when the turn injected none", () => {
    const messages = turnsToMessages(turns);
    expect("recalledMemoryIds" in messages[0]).toBe(false);
  });

  it("maps an empty list to an empty list", () => {
    expect(turnsToMessages([])).toEqual([]);
  });
});
