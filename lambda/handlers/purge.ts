/**
 * Purge Handler — POST /api/v1/purge
 *
 * Hard delete all user data from CRDB (irreversible).
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";

export async function handlePurge(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  // TODO: Implement
  return { statusCode: 200, body: JSON.stringify({ v: 1, ok: true, deletedRows: 0 }) };
}
