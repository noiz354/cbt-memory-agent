/**
 * On-device LLM engine — wraps @mlc-ai/web-llm MLCEngine.
 *
 * Lazily initializes on first call; downloads the model once and streams tokens.
 * The configured model matches the one referenced in llmRegistry for local-webllm.
 */

import * as webllm from "@mlc-ai/web-llm";

const MODEL_ID = "Phi-3-mini-4k-instruct-q4f16_1-MLC";

let engine: webllm.MLCEngine | null = null;
let initPromise: Promise<webllm.MLCEngine> | null = null;
let progress = 0;

export function getOnDeviceLoadProgress(): number {
  return progress;
}

function initEngine(): Promise<webllm.MLCEngine> {
  if (engine) return Promise.resolve(engine);
  if (!initPromise) {
    initPromise = (async () => {
      const e = new webllm.MLCEngine();
      progress = 0;
      await e.reload(MODEL_ID, {
        initProgressCallback: (p) => {
          progress = p.progress;
        },
      });
      engine = e;
      return e;
    })();
  }
  return initPromise;
}

/**
 * Streaming generation against the on-device engine.
 * Throws when WebLLM/WASM/WebGPU is unsupported or the model fails to load.
 */
export async function generateOnDevice(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  onDelta?: (delta: string) => void,
): Promise<{ content: string; tokensUsed: number }> {
  const e = await initEngine();
  const completion = await e.chat.completions.create({
    messages: messages as webllm.ChatCompletionMessageParam[],
    stream: Boolean(onDelta),
    temperature: 0.7,
    max_tokens: 2048,
  });

  let fullContent = "";
  if (onDelta && Symbol.asyncIterator in completion) {
    const stream = completion as unknown as AsyncIterable<{
      choices: { delta?: { content?: string } }[];
    }>;
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content ?? "";
      if (delta) {
        fullContent += delta;
        onDelta(delta);
      }
    }
  } else {
    const usage = (completion as unknown as { usage?: { completion_tokens?: number } }).usage;
    fullContent = (completion as unknown as { choices?: { message?: { content?: string } }[] })
      .choices?.[0]?.message?.content ?? "";
    return { content: fullContent, tokensUsed: usage?.completion_tokens ?? 0 };
  }

  return { content: fullContent, tokensUsed: 0 };
}
