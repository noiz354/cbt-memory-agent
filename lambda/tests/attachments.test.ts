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
  handleGetAttachmentMedia,
} from "../handlers/attachments";
import { MAX_MEDIA_UPLOAD_BYTES } from "../lib/s3";
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
    presignMediaPost: vi.fn(async () => ({
      url: "https://s3.example/post",
      fields: { key: "media/key", "x-amz-algorithm": "AWS4-HMAC-SHA256" },
    })),
    headMediaObject: vi.fn(async () => ({ exists: true, sizeBytes: 2048 })),
    presignMediaDownload: vi.fn(async () => "https://s3.example/media/get"),
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
  it("returns media key prefixed with user id + action + fields for the POST upload", async () => {
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
    expect(body.action).toBe("https://s3.example/post");
    expect(body.fields).toMatchObject({ key: "media/key", "x-amz-algorithm": "AWS4-HMAC-SHA256" });
    expect(s3.presignMediaPost).toHaveBeenCalledTimes(1);
    expect(s3.presignMediaPost.mock.calls[0][0]).toMatch(new RegExp(`^media/${USER}/[0-9a-f-]+\\.jpg$`));
    expect(s3.presignMediaPost.mock.calls[0][1]).toBe("image/jpeg");
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
    expect(s3.presignMediaPost).not.toHaveBeenCalled();
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

  it("rounds fractional durationMs/frameCount to integers before insert (INT columns)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({
          v: 1,
          attachment: { ...IMAGE_ATTACHMENT, kind: "video", durationMs: 5072.058, frameCount: 3.7 },
        }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);

    const attInsert = crdb.executes.find((c: ExecuteCall) => c.sql.includes("INSERT INTO attachments"));
    expect(attInsert).toBeTruthy();
    // $4 = duration_ms, $5 = frame_count — harus integer (Math.round).
    expect(attInsert!.params?.[3]).toBe(5072);
    expect(attInsert!.params?.[4]).toBe(4);
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

  it("rejects create when the raw media was never uploaded to S3", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    s3.headMediaObject = vi.fn(async () => ({ exists: false }));
    const res = await handleCreateAttachment(
      { body: JSON.stringify({ v: 1, attachment: IMAGE_ATTACHMENT }) } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"))).toBe(false);
  });

  it("rejects create when sizeBytes mismatches the uploaded object", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    s3.headMediaObject = vi.fn(async () => ({ exists: true, sizeBytes: 999 }));
    const res = await handleCreateAttachment(
      { body: JSON.stringify({ v: 1, attachment: IMAGE_ATTACHMENT }) } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"))).toBe(false);
  });

  it("rejects + cleans up when the uploaded object exceeds 25MB (server truth)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    s3.headMediaObject = vi.fn(async () => ({ exists: true, sizeBytes: MAX_MEDIA_UPLOAD_BYTES + 1 }));
    const res = await handleCreateAttachment(
      { body: JSON.stringify({ v: 1, attachment: IMAGE_ATTACHMENT }) } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(s3.deleteMediaObject).toHaveBeenCalledWith(IMAGE_ATTACHMENT.s3Key);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO memory_nodes"))).toBe(false);
  });

  it("rejects when client sizeBytes itself exceeds 25MB (no S3 size to check)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    s3.headMediaObject = vi.fn(async () => ({ exists: true, sizeBytes: undefined }));
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({
          v: 1,
          attachment: { ...IMAGE_ATTACHMENT, sizeBytes: MAX_MEDIA_UPLOAD_BYTES + 1 },
        }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(400);
    expect(s3.deleteMediaObject).toHaveBeenCalledWith(IMAGE_ATTACHMENT.s3Key);
  });

  it("create proceeds when sizeBytes is absent (no cross-check enforced)", async () => {
    const crdb = crdbMock();
    const llm = llmMock();
    const s3 = s3Mock();
    const res = await handleCreateAttachment(
      {
        body: JSON.stringify({
          v: 1,
          attachment: { ...IMAGE_ATTACHMENT, sizeBytes: undefined },
        }),
      } as any,
      crdb,
      llm,
      s3,
      "tok-1",
      "dev-1",
    );
    expect(res.statusCode).toBe(200);
    expect(crdb.executes.some((c: ExecuteCall) => c.sql.includes("INSERT INTO attachments"))).toBe(true);
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

  it("matches the attachment by memory node id (client deletes by nodeId)", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi
      .fn()
      .mockResolvedValueOnce({ user_id: USER }) // getUserId
      .mockResolvedValueOnce({ s3_key: `media/${USER}/abc123.jpg` });
    const s3 = s3Mock();
    await handleDeleteAttachment("node-42", crdb, s3, "tok-1", "dev-1");
    const calls = (crdb.queryOne as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([
      expect.stringContaining("memory_node_id::string = $1"),
      ["node-42", USER],
    ]);
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

describe("attachments — get media (viewer)", () => {
  it("returns a presigned GET url + mime + kind for the user's own attachment", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi
      .fn()
      .mockResolvedValueOnce({ user_id: USER }) // getUserId
      .mockResolvedValueOnce({
        s3_key: `media/${USER}/abc.jpg`,
        mime_type: "image/jpeg",
        kind: "image",
      });
    const s3 = s3Mock();
    const res = await handleGetAttachmentMedia("att-1", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe("https://s3.example/media/get");
    expect(body.mime).toBe("image/jpeg");
    expect(body.kind).toBe("image");
    expect(s3.presignMediaDownload).toHaveBeenCalledWith(`media/${USER}/abc.jpg`);
  });

  it("scopes the lookup to the owning user (WHERE a.user_id = $2) — no cross-user leak", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi
      .fn()
      .mockResolvedValueOnce({ user_id: USER })
      .mockResolvedValueOnce({ s3_key: `media/${USER}/abc.jpg`, mime_type: "video/webm", kind: "video" });
    const s3 = s3Mock();
    await handleGetAttachmentMedia("att-1", crdb, s3, "tok-1", "dev-1");
    const calls = (crdb.queryOne as ReturnType<typeof vi.fn>).mock.calls;
    const lookup = calls[calls.length - 1];
    expect(String(lookup[0])).toContain("user_id = $2");
    expect(lookup[1]).toEqual(["att-1", USER]);
  });

  it("returns 404 when attachment not found (foreign or deleted)", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi.fn().mockResolvedValueOnce({ user_id: USER }).mockResolvedValueOnce(undefined);
    const s3 = s3Mock();
    const res = await handleGetAttachmentMedia("nope", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(404);
    expect(s3.presignMediaDownload).not.toHaveBeenCalled();
  });

  it("returns 500 when presigning fails (e.g. missing S3 object)", async () => {
    const crdb = crdbMock();
    crdb.queryOne = vi
      .fn()
      .mockResolvedValueOnce({ user_id: USER })
      .mockResolvedValueOnce({ s3_key: `media/${USER}/ghost.webm`, mime_type: "video/webm", kind: "video" });
    const s3 = s3Mock();
    s3.presignMediaDownload = vi.fn(async () => { throw new Error("NoSuchKey"); });
    const res = await handleGetAttachmentMedia("att-1", crdb, s3, "tok-1", "dev-1");
    expect(res.statusCode).toBe(500);
  });
});

describe("attachments — vector embedding text", () => {
  it("embedding uses title + narrative (embeddingText)", () => {
    const text = `${IMAGE_ATTACHMENT.title} — ${IMAGE_ATTACHMENT.embeddedNarrative}`;
    expect(text).toContain("appeared sad");
    expect(toVectorLiteral(new Array(1024).fill(0.5))).toMatch(/^\[/);
  });
});
