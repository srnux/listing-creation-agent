import type { ModelClient, ModelRequest, ModelResponse, ScriptStep, Usage } from "./model.js";

export { call, say } from "./model.js";

/** Plays back a fixed script and records every request. Throws when asked for more turns than scripted. */
export class ScriptedModel implements ModelClient {
  readonly id = "scripted";
  readonly requests: ModelRequest[] = [];
  private next = 0;

  constructor(
    private readonly steps: ScriptStep[],
    private readonly usage: Usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.requests.push({ ...request, signal: undefined });
    const step = this.steps[this.next++];
    if (!step) throw new Error(`ScriptedModel: no step ${this.next} scripted`);
    const content = typeof step === "function" ? step(request) : step;
    return { content, stop: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { ...this.usage } };
  }
}
