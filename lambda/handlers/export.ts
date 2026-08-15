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
  // Not implemented. Return 501 so clients know this endpoint is unavailable —
  // previously it returned 200 with a fabricated s3Url, a silent false-success
  // that advertised a capability the app doesn't have.
  return {
    statusCode: 501,
    headers: {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN ?? "*",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      v: 2,
      ok: false,
      error: "Export upload is not implemented.",
    }),
  };
}
