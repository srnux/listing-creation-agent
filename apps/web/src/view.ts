import type { BrokerAnswer, BrokerQuestion, DraftSnapshot, Expose, FloorPlan, Outcome, PhotoAnalysis, Usage } from "@listing/core";
import type { TimedEvent } from "./api";

export type Item =
  | { kind: "model"; key: string; text: string }
  | { kind: "tool"; key: string; tool: string; input: unknown; end?: { summary: string; result: unknown; isError: boolean; durationMs: number } }
  | { kind: "question"; key: string; question: BrokerQuestion; prefill?: BrokerAnswer; answer?: BrokerAnswer; superseded?: boolean };

export interface RunView {
  items: Item[];
  pending?: BrokerQuestion;
  photos?: PhotoAnalysis;
  plan?: FloorPlan;
  expose?: Expose;
  done?: { outcome: Outcome; draft: DraftSnapshot; usage: Usage };
  elapsedMs: number;
}

/** Folds the event list into what the three panes show. */
export function view(events: TimedEvent[]): RunView {
  const items: Item[] = [];
  const tools = new Map<string, Extract<Item, { kind: "tool" }>>();
  const questions = new Map<string, Extract<Item, { kind: "question" }>>();
  const v: RunView = { items, elapsedMs: events.at(-1)?.t ?? 0 };

  for (const e of events) {
    switch (e.type) {
      case "model":
        items.push({ kind: "model", key: `m${items.length}`, text: e.text });
        break;
      case "tool_start": {
        const item = { kind: "tool" as const, key: e.callId, tool: e.tool, input: e.input };
        tools.set(e.callId, item);
        items.push(item);
        break;
      }
      case "tool_end": {
        const item = tools.get(e.callId);
        if (item) item.end = { summary: e.summary, result: e.result, isError: e.isError, durationMs: e.durationMs };
        if (!e.isError && e.tool === "analyze_photos") v.photos = e.result as PhotoAnalysis;
        if (!e.isError && e.tool === "read_floor_plan") v.plan = e.result as FloorPlan;
        if (!e.isError && e.tool === "submit_expose") v.expose = item?.input as Expose;
        break;
      }
      case "question": {
        // A re-ask replaces the earlier form for the same ask_broker call.
        for (const q of questions.values()) if (!q.answer) q.superseded = true;
        const item = { kind: "question" as const, key: e.question.id, question: e.question, prefill: e.prefill };
        questions.set(e.question.id, item);
        items.push(item);
        break;
      }
      case "answer": {
        const q = questions.get(e.questionId);
        if (q) q.answer = e.answer;
        break;
      }
      case "done":
        v.done = { outcome: e.outcome, draft: e.draft, usage: e.usage };
        v.photos ??= e.draft.photos;
        v.plan ??= e.draft.plan;
        v.expose ??= e.draft.expose;
        break;
    }
  }
  if (!v.done) v.pending = [...questions.values()].reverse().find((q) => !q.answer && !q.superseded)?.question;
  return v;
}

export const TOOL_LABELS: Record<string, string> = {
  record_facts: "Record facts from the notes",
  analyze_photos: "Analyse photos",
  read_floor_plan: "Read floor plan",
  compare_sources: "Compare notes, plan and photos",
  check_listing: "Check required fields",
  ask_broker: "Ask the broker",
  submit_expose: "Submit exposé (number check)",
  export_openimmo: "Export OpenImmo XML",
};
