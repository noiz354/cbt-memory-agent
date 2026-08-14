/**
 * S3 Client — export bundle storage.
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

export class S3ClientService {
  private client: S3Client;
  private bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
    this.client = new S3Client({ region: "us-east-1" });
  }

  /**
   * Upload export bundle, return presigned URL (24h expiry).
   */
  async uploadExport(userId: string, bundle: Record<string, unknown>): Promise<string> {
    const key = `exports/${userId}/${uuidv4()}.json`;

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
}
