/**
 * S3 Client — export bundle storage.
 *
 * Boundary instrumentation (OTel): operasi PutObject/GetObject dibungkus span
 * `aws.s3.operation` + RED metric. Tanpa userId di attribute (hindari PII).
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, DeleteObjectsCommand, ObjectIdentifier } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";
import { context, trace, SpanStatusCode } from "@opentelemetry/api";
import { ATTR_RPC_SYSTEM } from "@opentelemetry/semantic-conventions/incubating";
import { recordS3Operation } from "./telemetry";

export class S3ClientService {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    this.client = new S3Client({ region: process.env.AWS_REGION ?? "ap-southeast-3" });
  }

  /**
   * Upload export bundle, return presigned URL (24h expiry).
   */
  async uploadExport(userId: string, bundle: Record<string, unknown>): Promise<string> {
    const key = `exports/${userId}/${uuidv4()}.json`;

    return this.traced("PutObject", async () => {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: JSON.stringify(bundle),
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
        }),
      );

      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const url = await getSignedUrl(this.client, command, { expiresIn: 86400 });
      return url;
    });
  }

  /**
   * Presign an upload URL for raw media (emotion analysis attachments).
   * Client PUT-upload blob langsung ke S3; 15 menit untuk mengejar perekaman.
   */
  async presignMediaUpload(key: string, mimeType?: string): Promise<string> {
    return this.traced("PutObject", async () => {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: mimeType,
        ServerSideEncryption: "AES256",
      });
      return await getSignedUrl(this.client, command, { expiresIn: 900 });
    });
  }

  /** Delete satu object media (raw bytes) dari bucket. */
  async deleteMediaObject(key: string): Promise<void> {
    await this.traced("DeleteObject", async () => {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    });
  }

  /**
   * Delete SEMUA object media milik user (prefix `media/{userId}/`).
   * Dipakai hard purge; idempotent walau tidak ada object.
   */
  async deleteMediaPrefix(userId: string): Promise<number> {
    const prefix = `media/${userId}/`;
    return this.traced("DeleteObjects", async () => {
      let deleted = 0;
      for (;;) {
        const listed = await this.client.send(
          new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }),
        );
        const objects = (listed.Contents ?? []).filter(
          (o): o is { Key: string } => typeof o.Key === "string",
        );
        if (objects.length === 0) break;
        await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: { Objects: objects.map((o): ObjectIdentifier => ({ Key: o.Key })) },
          }),
        );
        deleted += objects.length;
        if (!listed.IsTruncated) break;
      }
      return deleted;
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: "health-check.tmp",
          Body: "",
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Wrapper terpusat: span `aws.s3.operation` + metric durasi. */
  private async traced<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const tracer = trace.getTracer("cbt-memory-agent-backend", "0.1.0");
    const parentCtx = context.active();
    const span = tracer.startSpan("aws.s3.operation", { attributes: {} }, parentCtx);
    const startedAt = Date.now();

    span.setAttribute(ATTR_RPC_SYSTEM, "aws.s3");
    span.setAttribute("aws.s3.operation", operation);

    try {
      return await context.with(trace.setSpan(parentCtx, span), () => fn());
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
      recordS3Operation(operation, Date.now() - startedAt);
    }
  }
}
