import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import { DEFAULT_AI_MODEL } from "@/constants";

// The AI binding from the Cloudflare env (`env.AI`).
export type AiBinding = Awaited<ReturnType<typeof getCloudflareContext>>["env"]["AI"];

interface RunAiTextParams {
  AI: AiBinding;
  prompt: string;
  maxTokens?: number;
}

// Runs DEFAULT_AI_MODEL as a chat completion and returns the assistant's text
// (or null). Centralizes the chat-message interface so swapping DEFAULT_AI_MODEL
// only needs to touch this file, not every call site.
export async function runAiText({
  AI,
  prompt,
  maxTokens,
}: RunAiTextParams): Promise<string | null> {
  const messages = [{ role: "user" as const, content: prompt }];

  const result = await AI.run(DEFAULT_AI_MODEL, {
    messages,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  });

  // Workers AI output shape varies by model: text-generation models return `{ response }`, chat-completions
  // models return `{ choices[].message.content }`, and some return both. Read defensively so a model swap
  // doesn't silently yield null. A non-string `response` (e.g. an already-parsed JSON array) is re-serialized so callers that expect text/JSON still work.
  const output = result as unknown as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (typeof output.response === "string") {
    return output.response;
  }
  const choiceContent = output.choices?.[0]?.message?.content;
  if (typeof choiceContent === "string") {
    return choiceContent;
  }
  if (output.response !== undefined && output.response !== null) {
    return JSON.stringify(output.response);
  }
  return null;
}
