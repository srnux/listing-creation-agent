import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunEvent } from "@listing/core";
import { expect, test } from "vitest";
import { replayRun } from "../src/replay.js";

const done: RunEvent = {
  type: "done",
  outcome: { status: "incomplete", reason: "x" },
  draft: { notes: "", facts: [] },
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

function recording(events: (RunEvent & { t: number })[]): string {
  const file = join(mkdtempSync(join(tmpdir(), "replay-")), "run.json");
  writeFileSync(file, JSON.stringify({ startedAt: "2026-11-18T00:00:00Z", events }));
  return file;
}

test("emits recorded events in order with gaps divided by speed", async () => {
  const file = recording([
    { type: "model", turn: 1, text: "a", t: 0 },
    { type: "model", turn: 2, text: "b", t: 100 },
    { ...done, t: 300 },
  ]);
  const seen: string[] = [];
  const started = performance.now();
  await replayRun(file, (e) => seen.push(e.type === "model" ? e.text : e.type), { speed: 2, waitForAnswer: async () => {} });
  const ms = performance.now() - started;
  expect(seen).toEqual(["a", "b", "done"]);
  expect(ms).toBeGreaterThan(120);
  expect(ms).toBeLessThan(400);
});

test("pauses at a question until answered, prefilled with the recorded answer, and skips the human wait", async () => {
  const file = recording([
    { type: "question", question: { id: "q1", question: "Zimmer?", fields: ["rooms"] }, t: 0 },
    { type: "answer", questionId: "q1", answer: { rooms: 4 }, t: 60_000 },
    { ...done, t: 60_010 },
  ]);
  const emitted: RunEvent[] = [];
  let release!: () => void;
  const answered = new Promise<void>((r) => (release = r));
  const replay = replayRun(file, (e) => emitted.push(e), { speed: 1, waitForAnswer: () => answered });
  await new Promise((r) => setTimeout(r, 50));
  expect(emitted.map((e) => e.type)).toEqual(["question"]);
  expect(emitted[0]).toMatchObject({ prefill: { rooms: 4 } });
  const started = performance.now();
  release();
  await replay;
  expect(emitted.map((e) => e.type)).toEqual(["question", "answer", "done"]);
  expect(performance.now() - started).toBeLessThan(500);
});

test("an aborted replay stops emitting", async () => {
  const file = recording([
    { type: "model", turn: 1, text: "a", t: 0 },
    { type: "model", turn: 2, text: "b", t: 5_000 },
  ]);
  const ac = new AbortController();
  const seen: string[] = [];
  const p = replayRun(file, (e) => seen.push(e.type), { speed: 1, waitForAnswer: async () => {}, signal: ac.signal });
  await new Promise((r) => setTimeout(r, 30));
  ac.abort(new Error("superseded"));
  await expect(p).rejects.toThrow("superseded");
  expect(seen).toEqual(["model"]);
});
