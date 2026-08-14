/**
 * Export Handler — POST /api/v1/export
 *
 * Builds JSON bundle, uploads to S3, returns presigned URL.
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { S3ClientService } from "../lib/s3";

export async function handleExport(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  s3: S3ClientService,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  // TODO: Implement
  return {
    statusCode: 200,
    body: JSON.stringify({
      v: 2,
      exportedAt: new Date().toISOString(),
      s3Url: "https://s3.amazonaws.com/...",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    }),
  };
}
