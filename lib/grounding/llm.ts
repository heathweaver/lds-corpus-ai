import Anthropic from "@anthropic-ai/sdk";

/**
 * LLM boundary. Everything that calls a model goes through this interface so
 * generation, verification, and tests can be wired independently (a mock
 * LlmClient drives the guardrail tests with no API key / network).
 *
 * Every call is forced tool-use with a strict input schema, so the model must
 * return validated structured data — never free-form prose we then parse.
 */

export interface ToolCallRequest {
  system: string;
  user: string;
  tool: Anthropic.Tool;
  maxTokens?: number;
  /** Override the model for this call (e.g. a stricter verifier model). */
  model?: string;
  /** Cache the (static) system block across calls. */
  cacheSystem?: boolean;
}

export interface LlmClient {
  /** Run a forced tool call and return the tool input, validated by the model. */
  toolCall<T>(req: ToolCallRequest): Promise<T>;
  /** Model id used by default (for provenance records). */
  readonly defaultModel: string;
}

export function llmAvailable(): boolean {
  return !!Deno.env.get("ANTHROPIC_API_KEY");
}

/** Real Anthropic-backed client. Requires ANTHROPIC_API_KEY. */
export function anthropicClient(): LlmClient {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for LLM calls");
  const client = new Anthropic({ apiKey });
  const defaultModel = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

  return {
    defaultModel,
    async toolCall<T>(req: ToolCallRequest): Promise<T> {
      const res = await client.messages.create({
        model: req.model ?? defaultModel,
        max_tokens: req.maxTokens ?? 1024,
        system: [{
          type: "text",
          text: req.system,
          ...(req.cacheSystem ? { cache_control: { type: "ephemeral" } } : {}),
        }],
        tools: [req.tool],
        tool_choice: { type: "tool", name: req.tool.name },
        messages: [{ role: "user", content: req.user }],
      });
      const block = res.content.find((b) => b.type === "tool_use") as
        | Anthropic.ToolUseBlock
        | undefined;
      if (!block) throw new Error(`Model did not call tool ${req.tool.name}`);
      return block.input as T;
    },
  };
}

/** Model used specifically for verification (defaults to a strict/cheap tier). */
export function verifierModel(): string {
  return Deno.env.get("ANTHROPIC_VERIFIER_MODEL") ??
    Deno.env.get("ANTHROPIC_MODEL") ??
    "claude-sonnet-5";
}
