/**
 * Session Handlers — GET/POST /api/v1/session, /api/v1/sessions
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";

export async function handleSaveSession(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  return { statusCode: 200, body: JSON.stringify({ v: 1, ok: true, id: "ses_new" }) };
}

export async function handleListSessions(
  qs: Record<string, string | undefined>,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  return { statusCode: 200, body: JSON.stringify({ v: 1, sessions: [] }) };
}
