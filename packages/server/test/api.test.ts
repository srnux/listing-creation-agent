import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelClient, RunEvent } from "@listing/core";
import { call, say, ScriptedModel } from "@listing/core/testing";
import { afterEach, expect, test } from "vitest";
import { createApp } from "../src/api.js";
import { RunRegistry } from "../src/runs.js";

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(models: (() => ModelClient)[]) {
  const dir = mkdtempSync(join(tmpdir(), "listing-api-"));
  let n = 0;
  const registry = new RunRegistry({
    model: () => models[n++]!(),
    vision: () => new ScriptedModel([]),
    tone: "tone",
    outRoot: join(dir, "out"),
    runsDir: join(dir, "runs"),
  });
  const server = createApp({ registry });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, registry, dir };
}

/** Reads the SSE stream, calling onEvent for each event, until "done". */
async function readEvents(base: string, runId: string, onEvent: (e: RunEvent) => void | Promise<void> = () => {}): Promise<RunEvent[]> {
  const res = await fetch(`${base}/runs/${runId}/events`);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const events: RunEvent[] = [];
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return events;
    buf += value;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      const e = JSON.parse(data.slice(6)) as RunEvent;
      events.push(e);
      await onEvent(e);
      if (e.type === "done") {
        await reader.cancel();
        return events;
      }
    }
  }
}

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("sample run streams tool events, pauses on a question, resumes on answer, ends with done", async () => {
  const { base } = await start([
    () =>
      new ScriptedModel([
        [call("check_listing", {})],
        [call("ask_broker", { question: "Wie viele Zimmer?", fields: ["rooms"] })],
        [say("Fertig.")],
      ]),
  ]);
  const { runId } = (await (await post(`${base}/runs`, { sample: true })).json()) as { runId: string };
  const events = await readEvents(base, runId, async (e) => {
    if (e.type === "question") expect((await post(`${base}/runs/${runId}/answers`, { questionId: e.question.id, answer: { rooms: 4 } })).status).toBe(204);
  });
  const types = events.map((e) => e.type);
  expect(types).toEqual(expect.arrayContaining(["tool_start", "tool_end", "question", "answer", "model", "done"]));
  const done = events.at(-1) as Extract<RunEvent, { type: "done" }>;
  expect(done.outcome.status).toBe("incomplete");
  expect(done.draft.facts.find((f) => f.field === "rooms")).toMatchObject({ value: 4, source: "broker" });
});

test("GET /sample lists the sample photos and notes", async () => {
  const { base } = await start([]);
  const s = (await (await fetch(`${base}/sample`)).json()) as { notes: string; photos: { id: string; url: string }[]; planUrl: string };
  expect(s.notes).toContain("3 Zimmer");
  expect(s.photos).toHaveLength(16);
  expect((await fetch(`${base}${s.photos[0]!.url}`)).headers.get("content-type")).toBe("image/jpeg");
  expect((await fetch(`${base}/sample/files/..%2F..%2Fpackage.json`)).status).toBe(404);
});

test("answering an unknown question returns 409, an unknown run 404", async () => {
  const { base } = await start([() => new ScriptedModel([[say("ok")]])]);
  const { runId } = (await (await post(`${base}/runs`, { sample: true })).json()) as { runId: string };
  expect((await post(`${base}/runs/${runId}/answers`, { questionId: "q99", answer: {} })).status).toBe(409);
  expect((await post(`${base}/runs/nope/answers`, { questionId: "q1", answer: {} })).status).toBe(404);
});

test("starting a second run aborts the first and its pending question", async () => {
  const { base, registry } = await start([
    () => new ScriptedModel([[call("ask_broker", { question: "Zimmer?", fields: ["rooms"] })], [say("never")]]),
    () => new ScriptedModel([[say("second")]]),
  ]);
  const first = (await (await post(`${base}/runs`, { sample: true })).json()) as { runId: string };
  await readEvents(base, first.runId, async (e) => {
    if (e.type === "question") await post(`${base}/runs`, { sample: true });
  });
  const done = registry.get(first.runId)!.events.at(-1)!;
  expect(done).toMatchObject({ type: "done", outcome: { status: "failed" } });
  expect(JSON.stringify(done)).toContain("superseded");
});

test("a model error reaches the client as done failed", async () => {
  const { base } = await start([
    () => ({
      id: "throws",
      complete: async () => {
        throw new Error("ThrottlingException");
      },
    }),
  ]);
  const { runId } = (await (await post(`${base}/runs`, { sample: true })).json()) as { runId: string };
  const events = await readEvents(base, runId);
  expect(events.at(-1)).toMatchObject({ type: "done", outcome: { status: "failed", reason: expect.stringContaining("Throttling") } });
});

test("a finished run is recorded to the runs folder", async () => {
  const { base, dir } = await start([() => new ScriptedModel([[say("ok")]])]);
  const { runId } = (await (await post(`${base}/runs`, { sample: true })).json()) as { runId: string };
  await readEvents(base, runId);
  const { readdirSync, readFileSync } = await import("node:fs");
  const files = readdirSync(join(dir, "runs"));
  expect(files).toHaveLength(1);
  const rec = JSON.parse(readFileSync(join(dir, "runs", files[0]!), "utf8"));
  expect(rec.events.at(-1).type).toBe("done");
  expect(typeof rec.events[0].t).toBe("number");
});

test("POST /runs rejects a body without photos", async () => {
  const { base } = await start([]);
  expect((await post(`${base}/runs`, { notes: "x", photos: [] })).status).toBe(400);
});
