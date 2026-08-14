/**
 * Memory Handlers — GET/POST/DELETE /api/v1/memory
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";

export async function handleListMemory(
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  return { statusCode: 200, body: JSON.stringify({ v: 1, nodes: [], edges: [] }) };
}

export async function handleUpsertMemory(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  return { statusCode: 200, body: JSON.stringify({ v: 1, ok: true, id: "mem_new" }) };
}

export async function handleDeleteMemory(
  id: string,
  crdb: CrdbClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  return { statusCode: 200, body: JSON.stringify({ v: 1, ok: true, deletedId: id }) };
}
