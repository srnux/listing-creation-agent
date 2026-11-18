import { z } from "zod";

/**
 * The agent's view of a language model. No provider types cross this line, so the loop, the tools and their
 * tests run offline against ScriptedModel.
 */

export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

export type Block =
  | { type: "text"; text: string }
  | { type: "image"; mediaType: ImageMediaType; data: string }
  | { type: "document"; mediaType: "application/pdf"; data: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean }
  /** A block the loop does not read (thinking) but must send back unchanged. */
  | { type: "provider"; block: unknown };

export interface Message {
  role: "user" | "assistant";
  content: string | Block[];
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export interface ModelRequest {
  system: string;
  tools: ToolDef[];
  messages: Message[];
  maxTokens: number;
  /** Forces the model to call this tool. */
  toolChoice?: { name: string };
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: Block[];
  stop: "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";
  usage: Usage;
}

export interface ModelClient {
  readonly id: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
}

/** One scripted turn: fixed blocks, or blocks computed from the request just sent. */
export type ScriptStep = Block[] | ((request: ModelRequest) => Block[]);

export const say = (text: string): Block => ({ type: "text", text });
let callCounter = 0;
export const call = (name: string, input: Record<string, unknown>, id = `toolu_${name}_${++callCounter}`): Block => ({
  type: "tool_use",
  id,
  name,
  input,
});

export class StructuredCallError extends Error {
  override name = "StructuredCallError";
}

/** A JSON schema for a tool input, from a zod schema. */
export const jsonSchema = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
};

/** One model call that must answer through one forced tool; the input is validated with the schema. */
export async function structuredCall<S extends z.ZodType>(
  model: ModelClient,
  opts: { system: string; content: Block[]; toolName: string; description: string; schema: S; maxTokens?: number; signal?: AbortSignal },
): Promise<z.infer<S>> {
  const res = await model.complete({
    system: opts.system,
    tools: [{ name: opts.toolName, description: opts.description, inputSchema: jsonSchema(opts.schema) }],
    toolChoice: { name: opts.toolName },
    messages: [{ role: "user", content: opts.content }],
    maxTokens: opts.maxTokens ?? 8_000,
    signal: opts.signal,
  });
  const use = res.content.find((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use" && b.name === opts.toolName);
  if (!use) throw new StructuredCallError(`${model.id} did not call ${opts.toolName} (stop: ${res.stop})`);
  const parsed = opts.schema.safeParse(use.input);
  if (!parsed.success) throw new StructuredCallError(`${opts.toolName} input invalid: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
