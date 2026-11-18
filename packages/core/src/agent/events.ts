import type { DraftSnapshot } from "../domain/draft.js";
import type { FieldId } from "../domain/fields.js";
import type { Usage } from "../model.js";

export interface BrokerQuestion {
  id: string;
  question: string;
  fields: FieldId[];
  /** Why the agent asks, or what was wrong with the last answer. */
  context?: string;
}

export type BrokerAnswer = Partial<Record<FieldId, unknown>>;

export type Outcome =
  | { status: "exported"; file: string; valid: boolean; mode: "xsd" | "fallback" }
  | { status: "incomplete"; reason: string }
  | { status: "failed"; reason: string };

export type RunEvent =
  | { type: "model"; turn: number; text: string }
  | { type: "tool_start"; callId: string; tool: string; input: unknown }
  | { type: "tool_end"; callId: string; tool: string; summary: string; result: unknown; isError: boolean; durationMs: number }
  /** prefill: the recorded answer, when a replay asks the question again. */
  | { type: "question"; question: BrokerQuestion; prefill?: BrokerAnswer }
  | { type: "answer"; questionId: string; answer: BrokerAnswer }
  | { type: "done"; outcome: Outcome; draft: DraftSnapshot; usage: Usage };
