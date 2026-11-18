import { emptyUsage, type Block, type Message, type ModelClient, type Usage } from "../model.js";
import type { Outcome, RunEvent } from "./events.js";
import { systemPrompt } from "./prompt.js";
import { createTools, RunAbort, type RunContext, type Tool, type ToolResult } from "./tools.js";

export type { Outcome, RunEvent } from "./events.js";

export interface Limits {
  /** Model calls per run. */
  maxTurns: number;
  /** Input, cache and output tokens summed over the run. */
  tokenBudget: number;
  modelTimeoutMs: number;
  /** Per tool call, except tools that wait for a person. */
  toolTimeoutMs: number;
  /** Output cap per model call. */
  maxTokens: number;
}

export const defaultLimits: Limits = {
  maxTurns: 20,
  tokenBudget: 400_000,
  modelTimeoutMs: 120_000,
  toolTimeoutMs: 120_000,
  maxTokens: 16_000,
};

export interface RunDeps {
  model: ModelClient;
  ctx: RunContext;
  tone: string;
  limits?: Partial<Limits>;
  onEvent?(e: RunEvent): void;
  /** Aborting ends the run as failed, with the abort reason. */
  signal?: AbortSignal;
}

const total = (u: Usage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Timeout extends Error {}

/** Resolves with the promise, or rejects when the signal aborts. */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function firstMessage(ctx: RunContext): string {
  return [
    "Notizen des Maklers:",
    ctx.draft.notes.trim(),
    "",
    `Fotos: ${ctx.photos.length} Dateien (${ctx.photos.map((p) => p.id).join(", ")}).`,
    `Grundriss: vorhanden (${ctx.plan.mediaType}).`,
    "",
    "Erstelle das Exposé und den OpenImmo-Export.",
  ].join("\n");
}

/** The tool-use loop. The rules live in the tools; the loop enforces limits and never throws. */
export async function runListing(deps: RunDeps): Promise<{ outcome: Outcome; usage: Usage }> {
  const { model, ctx, onEvent } = deps;
  const limits = { ...defaultLimits, ...deps.limits };
  const runSignal = deps.signal ?? new AbortController().signal;
  const usage = emptyUsage();
  ctx.emit = onEvent;
  const tools = createTools(ctx);
  const byName = new Map<string, Tool>(tools.map((t) => [t.def.name, t]));
  const messages: Message[] = [{ role: "user", content: firstMessage(ctx) }];
  const system = systemPrompt(deps.tone);
  let exported: Extract<Outcome, { status: "exported" }> | undefined;
  let lastText = "";

  const done = (outcome: Outcome) => {
    onEvent?.({ type: "done", outcome, draft: ctx.draft.snapshot(), usage });
    return { outcome, usage };
  };

  const runTool = async (use: Extract<Block, { type: "tool_use" }>): Promise<ToolResult> => {
    const tool = byName.get(use.name);
    if (!tool) return { content: `Unknown tool ${use.name}.`, isError: true, summary: `unknown tool ${use.name}` };
    const signals = [runSignal];
    if (!tool.noTimeout) signals.push(AbortSignal.timeout(limits.toolTimeoutMs));
    const signal = AbortSignal.any(signals);
    try {
      return await until(tool.run(use.input, signal), signal);
    } catch (e) {
      if (e instanceof RunAbort || runSignal.aborted) throw e;
      if (signal.aborted) return { content: `Tool ${use.name} timed out after ${limits.toolTimeoutMs} ms.`, isError: true, summary: "timed out" };
      return { content: `Tool ${use.name} failed: ${message(e)}`, isError: true, summary: message(e).slice(0, 160) };
    }
  };

  try {
    for (let turn = 1; ; turn++) {
      if (turn > limits.maxTurns) return done({ status: "failed", reason: `Turn limit reached (${limits.maxTurns} model calls).` });
      if (total(usage) >= limits.tokenBudget) return done({ status: "failed", reason: `Token budget used up (${total(usage)} tokens).` });

      const signal = AbortSignal.any([runSignal, AbortSignal.timeout(limits.modelTimeoutMs)]);
      let response;
      try {
        response = await until(model.complete({ system, tools: tools.map((t) => t.def), messages, maxTokens: limits.maxTokens, signal }), signal);
      } catch (e) {
        if (runSignal.aborted) throw runSignal.reason;
        if (signal.aborted) throw new Timeout(`No model response within ${limits.modelTimeoutMs} ms.`);
        throw e;
      }
      usage.inputTokens += response.usage.inputTokens;
      usage.outputTokens += response.usage.outputTokens;
      usage.cacheReadTokens += response.usage.cacheReadTokens;
      usage.cacheWriteTokens += response.usage.cacheWriteTokens;
      messages.push({ role: "assistant", content: response.content });

      const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
      if (text) {
        lastText = text;
        onEvent?.({ type: "model", turn, text });
      }

      const uses = response.content.filter((b): b is Extract<Block, { type: "tool_use" }> => b.type === "tool_use");
      if (!uses.length) {
        if (response.stop === "max_tokens") return done({ status: "failed", reason: `Model output cut off at ${limits.maxTokens} tokens.` });
        if (response.stop === "refusal") return done({ status: "failed", reason: "The model refused." });
        return done(exported ?? { status: "incomplete", reason: lastText || "The agent stopped without exporting." });
      }

      const results: Block[] = [];
      for (const use of uses) {
        onEvent?.({ type: "tool_start", callId: use.id, tool: use.name, input: use.input });
        const started = performance.now();
        const res = await runTool(use);
        const isError = res.isError === true;
        onEvent?.({
          type: "tool_end",
          callId: use.id,
          tool: use.name,
          summary: res.summary ?? res.content.slice(0, 160),
          result: res.data ?? res.content,
          isError,
          durationMs: Math.round(performance.now() - started),
        });
        if (use.name === "export_openimmo" && !isError) {
          const d = res.data as { file: string; valid: boolean; mode: "xsd" | "fallback" };
          exported = { status: "exported", file: d.file, valid: d.valid, mode: d.mode };
        }
        results.push({ type: "tool_result", toolUseId: use.id, content: res.content, ...(isError && { isError }) });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    if (runSignal.aborted) return done({ status: "failed", reason: `Run aborted: ${message(runSignal.reason)}` });
    return done({ status: "failed", reason: message(e) });
  }
}
