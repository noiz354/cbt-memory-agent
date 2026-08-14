/**
 * Chat Turn Handler — POST /api/v1/chat/turn
 *
 * 1. Get memory context from CRDB
 * 2. Get semantic matches via vector index
 * 3. Build CBT prompt
 * 4. Stream Bedrock (Claude) response
 * 5. Save to chat_turns table
 */

import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { CrdbClient } from "../lib/crdb";
import { BedrockClient } from "../lib/bedrock";

export async function handleChatTurn(
  event: APIGatewayProxyEvent,
  crdb: CrdbClient,
  bedrock: BedrockClient,
  token: string,
  deviceId: string,
): Promise<APIGatewayProxyResult> {
  // TODO: Implement
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v: 1, message: "Not implemented yet" }),
  };
}
