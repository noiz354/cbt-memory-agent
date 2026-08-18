// @vitest-environment jsdom
/**
 * Regression test — ChatBubble tidak boleh memakai animasi layout framer-motion.
 *
 * Root cause bug overlap: prop `layout` pada motion.article bertabrakan dengan
 * virtualizer ChatStream (row absolute + translateY + measureElement). Animasi
 * layout mengubah posisi via transform saat streaming, membuat bubble overlap
 * sebelum virtualizer mengukur ulang.
 *
 * Render memakai react-dom/client createRoot langsung (bukan RTL) karena
 * react 19.2.8 + RTL 16.3.2 punya konflik `React.act` di environment ini.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import React from "react";

// Mock framer-motion — tangkap props yang di-pass ke motion.article.
const capturedProps: Record<string, unknown>[] = [];
vi.mock("framer-motion", () => ({
  motion: {
    article: ({ children, ...props }: { children?: React.ReactNode } & Record<string, unknown>) => {
      capturedProps.push(props);
      return React.createElement("article", props as Record<string, string>, children);
    },
  },
}));

// Mock dependensi berat ChatBubble agar test hermetic.
vi.mock("@/features/chat/lib/markdown", () => ({
  ChatMarkdown: ({ content }: { content: string }) => React.createElement("div", null, content),
}));
vi.mock("@/features/chat/store/chatStore", () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ triggerBargeIn: () => {}, setQuote: () => {} }),
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    isDragging: false,
  }),
}));
vi.mock("@dnd-kit/utilities", () => ({ CSS: { Translate: { toString: () => "" } } }));
vi.mock("react-router-dom", () => ({
  Link: ({ children }: { children: React.ReactNode }) => React.createElement("a", null, children),
}));
vi.mock("@/shared/lib/speech", () => ({ isSpeaking: () => false, toggleSpeak: () => {} }));
vi.mock("@/shared/lib/format", () => ({ formatClock: () => "12:00" }));
vi.mock("@/features/chat/lib/modelSelection", () => ({
  formatModelLabel: () => "model",
}));
vi.mock("./WaveformScrubber", () => ({ WaveformScrubber: () => null }));
vi.mock("./AttachmentViewer", () => ({ AttachmentViewer: () => null }));

import { ChatBubble } from "./ChatBubble";
import type { ChatMessage } from "@/features/chat/types";

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "Halo, bagaimana kabarmu?",
    createdAt: "2026-08-18T10:00:00Z",
    ...overrides,
  };
}

async function renderBubble(message: ChatMessage): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(React.createElement(ChatBubble, { message }));
  // React 19 createRoot flush render secara async — tunggu microtask.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { root, container };
}

function unmount(root: Root): void {
  root.unmount();
  document.body.innerHTML = "";
}

beforeEach(() => {
  capturedProps.length = 0;
  document.body.innerHTML = "";
});

describe("ChatBubble", () => {
  it("merender konten pesan asisten", async () => {
    const { root, container } = await renderBubble(makeMessage());
    expect(container.textContent).toContain("Halo, bagaimana kabarmu?");
    unmount(root);
  });

  it("tidak meneruskan prop layout ke motion.article (regresi overlap)", async () => {
    const { root } = await renderBubble(makeMessage());
    const articleProps = capturedProps[0];
    expect(articleProps).toBeDefined();
    // Root cause: `layout` dihapus dari ChatBubble — jika muncul lagi,
    // overlap bubble chat kembali terjadi di dalam virtualizer.
    expect(articleProps).not.toHaveProperty("layout");
    unmount(root);
  });

  it("merender konten pesan user dengan alignment yang benar", async () => {
    const { root, container } = await renderBubble(makeMessage({ role: "user", content: "Aku cemas." }));
    expect(container.textContent).toContain("Aku cemas.");
    const article = container.querySelector("article");
    expect(article?.className).toContain("justify-end");
    unmount(root);
  });
});
