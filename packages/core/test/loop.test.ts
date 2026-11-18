import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { BrokerAnswer, BrokerQuestion, RunEvent } from "../src/agent/events.js";
import { runListing } from "../src/agent/loop.js";
import type { RunContext } from "../src/agent/tools.js";
import { ListingDraft } from "../src/domain/draft.js";
import type { ModelClient } from "../src/model.js";
import { call, checkerJpeg, completeDraft, planWith4Rooms, say, SAMPLE_NOTES, ScriptedModel } from "../src/testing.js";

const ENERGY = {
  energy_certificate_type: "verbrauch",
  energy_value_kwh: 112,
  energy_carrier: "fernwaerme",
  energy_construction_year: 1962,
  energy_class: "D",
  energy_valid_until: "2032-05-31",
};

const NOTES_FACTS = [
  { field: "rooms", value: 3 },
  { field: "floor", value: 2 },
  { field: "kitchen_year", value: 2023 },
  { field: "balcony", value: true },
  { field: "balcony_orientation", value: "south" },
  { field: "price_cold_eur", value: 1450 },
  { field: "service_charges_eur", value: 220 },
  { field: "street", value: "Musterstraße 12" },
  { field: "postal_code", value: "20255" },
  { field: "city", value: "Hamburg" },
  { field: "district", value: "Eimsbüttel" },
  { field: "location_facts", value: ["Ruhige Seitenstraße", "5 Min. zur U-Bahn Osterstraße", "Park um die Ecke"] },
];

const visionScript = () =>
  new ScriptedModel([
    [
      call("report_photos", {
        photos: [
          { id: "01-living", room: "living", features: ["parquet"], quality: "ok", reasons: [] },
          { id: "04-kitchen", room: "kitchen", features: ["built-in kitchen"], quality: "ok", reasons: [] },
        ],
        order: ["01-living", "04-kitchen"],
        coverId: "01-living",
      }),
    ],
    [call("report_floor_plan", { rooms: planWith4Rooms.rooms, totalLivingArea_m2: 82.5 })],
  ]);

async function context(answers: Record<string, BrokerAnswer> = {}, delayMs = 0): Promise<RunContext> {
  return {
    draft: new ListingDraft(SAMPLE_NOTES),
    photos: [
      { id: "01-living", mediaType: "image/jpeg", data: await checkerJpeg(200, 190, 180, 1) },
      { id: "04-kitchen", mediaType: "image/jpeg", data: await checkerJpeg(150, 170, 200, 6) },
    ],
    plan: { mediaType: "image/png", data: Buffer.from("plan") },
    visionModel: visionScript(),
    askBroker: async (q: BrokerQuestion) => {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return answers[q.fields.join(",")] ?? {};
    },
    outDir: mkdtempSync(join(tmpdir(), "listing-loop-")),
  };
}

const happyScript = () =>
  new ScriptedModel([
    [say("Ich erfasse die Notizen."), call("record_facts", { facts: NOTES_FACTS })],
    [call("analyze_photos", {})],
    [call("read_floor_plan", {})],
    [call("check_listing", {})],
    [call("ask_broker", { question: "Notizen: 3 Zimmer, Grundriss: 4. Was stimmt?", fields: ["rooms"] })],
    [call("ask_broker", { question: "Bitte Energieausweis-Daten angeben.", fields: Object.keys(ENERGY) })],
    [call("submit_expose", completeDraft().expose!)],
    [call("export_openimmo", {})],
    [say("Fertig: das Exposé ist exportiert.")],
  ]);

test("happy path exports a valid file and emits events in order", async () => {
  const events: RunEvent[] = [];
  const ctx = await context({ rooms: { rooms: 4 }, [Object.keys(ENERGY).join(",")]: ENERGY });
  const { outcome } = await runListing({ model: happyScript(), ctx, tone: "tone", onEvent: (e) => events.push(e) });
  expect(outcome).toMatchObject({ status: "exported", valid: true });
  const types = events.map((e) => e.type);
  expect(types[0]).toBe("model");
  expect(types).toContain("question");
  expect(types).toContain("answer");
  expect(types.at(-1)).toBe("done");
  expect(events.filter((e) => e.type === "tool_end").every((e) => !(e as { isError: boolean }).isError)).toBe(true);
});

test("the system prompt carries the tone guide and the rule", async () => {
  const model = new ScriptedModel([[say("ok")]]);
  await runListing({ model, ctx: await context(), tone: "TONE-GUIDE-MARKER" });
  expect(model.requests[0]!.system).toContain("TONE-GUIDE-MARKER");
  expect(model.requests[0]!.system).toMatch(/never guess/i);
  expect(model.requests[0]!.tools.map((t) => t.name)).toContain("ask_broker");
});

test("ending without export is incomplete, not a hang", async () => {
  const model = new ScriptedModel([[call("check_listing", {})], [say("Ich bin fertig.")]]);
  const { outcome } = await runListing({ model, ctx: await context(), tone: "" });
  expect(outcome).toMatchObject({ status: "incomplete" });
  expect((outcome as { reason: string }).reason).toContain("Ich bin fertig.");
});

test("a model error ends the run as failed", async () => {
  const model: ModelClient = {
    id: "throws",
    complete: async () => {
      throw new Error("ThrottlingException: Too many requests");
    },
  };
  const events: RunEvent[] = [];
  const { outcome } = await runListing({ model, ctx: await context(), tone: "", onEvent: (e) => events.push(e) });
  expect(outcome).toMatchObject({ status: "failed" });
  expect((outcome as { reason: string }).reason).toContain("Throttling");
  expect(events.at(-1)?.type).toBe("done");
});

test("ask_broker is not cut by the tool timeout", async () => {
  const model = new ScriptedModel([
    [call("ask_broker", { question: "Wie viele Zimmer?", fields: ["rooms"] })],
    [say("Danke.")],
  ]);
  const ctx = await context({ rooms: { rooms: 4 } }, 100);
  await runListing({ model, ctx, tone: "", limits: { toolTimeoutMs: 20 } });
  expect(ctx.draft.get("rooms")).toMatchObject({ value: 4, source: "broker" });
});

test("other tools are cut by the tool timeout and the model sees the error", async () => {
  const slowVision: ModelClient = { id: "slow", complete: () => new Promise(() => {}) };
  const model = new ScriptedModel([[call("read_floor_plan", {})], [say("Stop.")]]);
  const ctx = await context();
  ctx.visionModel = slowVision;
  const { outcome } = await runListing({ model, ctx, tone: "", limits: { toolTimeoutMs: 30 } });
  const lastToolResult = (model.requests[1]!.messages.at(-1)!.content as { type: string; content?: string; isError?: boolean }[])[0]!;
  expect(lastToolResult.isError).toBe(true);
  expect(lastToolResult.content).toMatch(/timed out/i);
  expect(outcome.status).toBe("incomplete");
});

test("an aborted run ends as failed with the reason", async () => {
  const ac = new AbortController();
  const model = new ScriptedModel([
    () => {
      ac.abort(new Error("superseded by a new run"));
      return [call("check_listing", {})];
    },
    [say("never")],
  ]);
  const { outcome } = await runListing({ model, ctx: await context(), tone: "", signal: ac.signal });
  expect(outcome).toMatchObject({ status: "failed" });
  expect((outcome as { reason: string }).reason).toContain("superseded");
});

test("two number-guard failures end the run as failed", async () => {
  const bad = structuredClone(completeDraft().expose!);
  bad.de.description = "Ca. 95 m² Wohnfläche, ruhig gelegen.";
  const model = new ScriptedModel([[call("submit_expose", bad)], [call("submit_expose", bad)], [say("never")]]);
  const { outcome } = await runListing({ model, ctx: await context(), tone: "" });
  expect(outcome).toMatchObject({ status: "failed" });
  expect((outcome as { reason: string }).reason).toContain("95");
});
