/**
 * Bedrock Client — LLM inference + embeddings via Amazon Bedrock.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

export class BedrockClient {
  private client: BedrockRuntimeClient;

  constructor(region: string) {
    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * Generate embedding via Cohere embed-english-v3.
   * Returns 1024-dim vector.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: "cohere.embed-english-v3",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        texts: [text],
        input_type: "search_document",
      }),
    });

    const response = await this.client.send(command);
    const body = JSON.parse(new TextDecoder().decode(response.body));
    return body.embeddings[0];
  }

  /**
   * Generate CBT response via Claude (streaming).
   */
  async *generateCBTResponse(
    prompt: string,
  ): AsyncGenerator<string, void, unknown> {
    const command = new InvokeModelWithResponseStreamCommand({
      modelId: "anthropic.claude-sonnet-4-20250514-v1:0",
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const response = await this.client.send(command);

    for await (const chunk of response.body!) {
      if (chunk.chunk?.bytes) {
        const text = new TextDecoder().decode(chunk.chunk.bytes);
        try {
          const parsed = JSON.parse(text);
          if (parsed.type === "content_block_delta") {
            yield parsed.delta?.text ?? "";
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const command = new InvokeModelCommand({
        modelId: "anthropic.claude-haiku-3-5-20241022-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
          anthropic_version: "bedrock-2023-05-31",
          max_tokens: 10,
          messages: [{ role: "user", content: "Hi" }],
        }),
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }
}
