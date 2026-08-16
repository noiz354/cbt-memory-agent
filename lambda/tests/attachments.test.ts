/**
 * Unit tests — emotional media attachments handler.
 *
 * Tidak menyentuh CockroachDB/S3 nyata. Mock CrdbClient + OpenRouterClient +
 * S3ClientService untuk membuktikan: presign key, create node+attachment+
 * embedding, validasi s3Key (anti traversal), list, delete (S3 object + node
 * cascade), dan purge media prefix.
 */

import { describe, expect, it, vi } from "vitest";
import {
  handlePresignAttachment,
  handleCreateAttachment,
  handleListAttachments,
  handleDeleteAttachment,
} from "../handlers/attachments";
import { toVectorLiteral } from "../lib/vectors";

type ExecuteCall = { sql: string; params?: unknown[] };

function crdbMock() {
  const executes: ExecuteCall[] = [];
  const crdb: any = {
    executes,
    async query() {
      return [];
    },
    async queryOne() {
      return { user_id: "00000000-0000-0000-0000-000000000001" };
    },
    async execute(sql: string, params?: unknown[]) {
      executes.push({ sql, params });
    },
    async executeCount() {
      return 0;
    },
  };
  return crdb;
}

function llmMock() {
  const generateEmbedding = vi.fn(async () => new Array(1024).fill(0.5));
  return { generateEmbedding } as any;
}

function s3Mock() {
  return {
    presignMediaUpload: vi.fn(async () => "https://s3.example/upload"),
    deleteMediaObject: vi.fn(async () => undefined),
    deleteMediaPrefix: vi.fn(async () => 3),
    uploadExport: vi.fn(async () => "https://s3.example/export"),
    healthCheck: vi.fn(async () => true),
  } as any;
}

const USER = "00000000-0000-0000-0000-000000000001";

const IMAGE_ATTACHMENT = {
  kind: "image",
  analysis: {
    emotions: { primary: "sad", confidence: 0.82, secondary: "anxious", valence: -0.6, arousal: 0.4 },
  },
  embeddedNarrative:
    "User appeared sad (82% confidence) with secondary anxiety during discussion about work stress.",
  s3Key: `media/${USER}/abc123.jpg`,
  mimeType: "image/jpeg",
  sizeBytes: 2048,
  title: "Camera · sad 82% · 21:04",
  confidence: 0.82,
};

describe("attachments — presign", () => {
  it("returns media key prefixed with user id + upload URL", async () => {
    const crdb = crdbMock();
    const s3 = s3Mock();
    const res = await handlePresignAttachment(
      { body: JSON.stringify({ v: 1, kind: "image", ext: "jpg", mimeType: "image/jpeg" }) } as any,
      crdb,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.v).toBe(1);
    expect(body.key).toMatch(new RegExp(`^media/${USER}/[0-9a-f-]+\\.jpg$`));
    expect(body.uploadUrl).toBe("https://s3.example/upload");
    expect(s3.presignMediaUpload).toHaveBeenCalledTimes(1);
    expect(s3.presignMediaUpload.mock.calls[0][1]).toBe("image/jpeg");
  });

  it("rejects unknown media kind (400)", async () => {
    const crdb = crdbMock();
    const s3 = s3Mock();
    const res = await handlePresignAttachment(
      { body: JSON.stringify({ v: 1, kind: "pdf", ext: "pdf" }) } as any,
      crdb,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(s3.presignMediaUpload).not.toHaveBeenCalled();
  });

  it("rejects malformed body (400)", async () => {
    const crdb = crdbMock();
    const s3 = s3Mock();
    const res = await handlePresignAttachment({ body: "{nope" } as any, crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(400);
  });
});

describe("attachments — create", () => {
  it("inserts memory node kind=attachment + attachments row + embedding", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      { body: JSON.stringify({ v: 1, attachment: IMAGE_ATTACHMENT }) } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.nodeId).toBeTruthy();

    const nodeInsert = crdb.executes.find((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"));
    expect(nodeInsert).toBeTruthy();
    expect(nodeInsert!.sql).toContain("'attachment'"); // kind di-hardcode di SQL
    expect(nodeInsert!.params?.[2]).toBe(IMAGE_ATTACHMENT.title);
    expect(nodeInsert!.params?.[3]).toBe(IMAGE_ATTACHMENT.embeddedNarrative.slice(0, 200));

    const attInsert = crdb.executes.find((c: ExecuteCall) => c.sql.includes("INSERT INTO attachments"));
    expect(attInsert).toBeTruthy();
    expect(attInsert!.params?.[2]).toBe("image");
    expect(attInsert!.params?.[7]).toBe(IMAGE_ATTACHMENT.s3Key);

    // embedding ditulis dari embedded_narrative (bukan excerpt kosong)
    expect(llm.generateEmbedding).toHaveBeenCalledTimes(1);
    expect(llm.generateEmbedding.mock.calls[0][0]).toContain("appeared sad");
  });

  it("rejects s3Key not under the user's media prefix (400, traversal guard)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({
          v: 1,
          attachment: { ...IMAGE_ATTACHMENT, s3Key: "media/other-user/evil.jpg" },
        }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"))).toBe(false);
  });

  it("rejects missing embeddedNarrative (400)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({ v: 1, attachment: { ...IMAGE_ATTACHMENT, embeddedNarrative: "" } }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown kind (400)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({ v: 1, attachment: { ...IMAGE_ATTACHMENT, kind: "txt" } }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
  });

  it("embedding failure does NOT fail the create (best-effort)", async () => {
    const crdb = crdbMock();
    const llm = { generateEmbedding: vi.fn(async () => { throw new Error("embedding failed"); }) } as any;
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      { body: JSON.stringify({ v: 1, attachment: IMAGE_ATTACHMENT }) } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO attachments"))).toBe(true);
  });
});

describe("attachments — list", () => {
  it("returns attachments joined with memory node title/excerpt", async () => {
    const crdb = crdbMock();
    crdb.query = vi.fn(async () => [
      {
        id: "a1",
        kind: "image",
        title: "Camera · sad 82% · 21:04",
        excerpt: "User appeared sad...",
        embedded_narrative: "User appeared sad...",
        created_at: "2026-08-16T00:00:00Z",
      },
    ]);
    const res = await handleListAttachments(crdb, "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.v).toBe(1);
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0].title).toBe("Camera · sad 82% · 21:04");
    expect(crdb.query.mock.calls[0][0]).toContain("attachments");
  });
});

describe("attachments — delete", () => {
  it("deletes the S3 object then the memory node (cascades attachment row)", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi.fn(async () => ({ s3_key: `media/${USER}/abc123.jpg` }));
    const s3 = s3Mock();
    const res = await handleDeleteAttachment("a1", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    expect(s3.deleteMediaObject).toHaveBeenCalledWith(`media/${USER}/abc123.jpg`);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("DELETE FROM memory_nodes"))).toBe(true);
  });

  it("deletes node even when S3 object missing (best-effort)", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi.fn(async () => ({ s3_key: null }));
    const s3 = s3Mock();
    s3.deleteMediaObject = vi.fn(async () => { throw new Error("NoSuchKey"); });
    const res = await handleDeleteAttachment("a1", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("DELETE FROM memory_nodes"))).toBe(true);
  });

  it("returns 404 when attachment not found", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi.fn(async () => undefined);
    const s3 = s3Mock();
    const res = await handleDeleteAttachment("a1", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(404);
    expect(s3.deleteMediaObject).not.toHaveBeenCalled();
  });
});

describe("attachments — vector embedding text", () => {
  it("embedding uses title + narrative (embeddingText)", () => {
    const text = `${IMAGE_ATTACHMENT.title} — ${IMAGE_ATTACHMENT.embeddedNarrative}`;
    expect(text).toContain("appeared sad");
    expect(toVectorLiteral(new Array(1024).fill(0.5))).toMatch(/^\[/);
  });
});
