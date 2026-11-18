import Anthropic, { betaRefusalFallbackMiddleware } from "@anthropic-ai/sdk";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import type { Block, Message, ModelClient, ModelRequest, ModelResponse } from "@listing/core";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Bedrock serves current models through inference profiles; eu. keeps requests inside the EU. */
export const DEFAULT_ORCHESTRATOR = "eu.anthropic.claude-opus-5-5";
export const DEFAULT_VISION = "eu.anthropic.claude-sonnet-5-5";
const FALLBACK_MODEL = "eu.anthropic.claude-opus-4-8";

/** The one resource the adapter uses. */
export type MessagesClient = { beta: { messages: Pick<Anthropic["beta"]["messages"], "create"> } };

export interface BedrockOptions {
  model?: string;
  effort?: Effort;
  client?: MessagesClient;
}

export const missingCredentials = (): string | undefined =>
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION ? undefined : "Set AWS_REGION (e.g. eu-central-1) in .env.";

const defaultClient = (): MessagesClient =>
  new AnthropicBedrock({
    // bedrock-runtime rejects the fallback-credit beta, so retries run without it.
    middleware: [betaRefusalFallbackMiddleware([{ model: FALLBACK_MODEL }], { betas: [] })],
  });

const toParam = (b: Block): Anthropic.Beta.BetaContentBlockParam => {
  switch (b.type) {
    case "text":
      return { type: "text", text: b.text };
    case "image":
      return { type: "image", source: { type: "base64", media_type: b.mediaType, data: b.data } };
    case "document":
      return { type: "document", source: { type: "base64", media_type: b.mediaType, data: b.data } };
    case "tool_use":
      return { type: "tool_use", id: b.id, name: b.name, input: b.input };
    case "tool_result":
      return { type: "tool_result", tool_use_id: b.toolUseId, content: b.content, ...(b.isError && { is_error: true }) };
    case "provider":
      return b.block as Anthropic.Beta.BetaContentBlockParam;
  }
};

const fromResponse = (b: Anthropic.Beta.BetaContentBlock): Block =>
  b.type === "text"
    ? { type: "text", text: b.text }
    : b.type === "tool_use"
      ? { type: "tool_use", id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }
      : { type: "provider", block: b };

const stops: Record<string, ModelResponse["stop"]> = {
  end_turn: "end_turn",
  tool_use: "tool_use",
  max_tokens: "max_tokens",
  refusal: "refusal",
};

/** The Messages API on Amazon Bedrock behind ModelClient. Forced tool calls run without effort/thinking. */
export class BedrockModel implements ModelClient {
  readonly id: string;
  private readonly client: MessagesClient;
  private readonly effort: Effort;

  constructor(opts: BedrockOptions = {}) {
    this.id = opts.model ?? process.env.ORCHESTRATOR_MODEL ?? DEFAULT_ORCHESTRATOR;
    this.effort = opts.effort ?? "medium";
    this.client = opts.client ?? defaultClient();
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const res = await this.client.beta.messages.create(
      {
        model: this.id,
        max_tokens: req.maxTokens,
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        ...(req.tools.length && {
          tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema })),
        }),
        ...(req.toolChoice ? { tool_choice: { type: "tool" as const, name: req.toolChoice.name } } : { output_config: { effort: this.effort } }),
        messages: req.messages.map((m: Message) => ({
          role: m.role,
          content: typeof m.content === "string" ? m.content : m.content.map(toParam),
        })),
      },
      { signal: req.signal },
    );
    return {
      content: res.content.map(fromResponse),
      stop: stops[res.stop_reason ?? ""] ?? "other",
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
