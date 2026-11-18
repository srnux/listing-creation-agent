import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createTools, RunAbort, type BrokerAnswer, type BrokerQuestion, type RunContext, type Tool } from "../src/agent/tools.js";
import { ListingDraft } from "../src/domain/draft.js";
import { completeDraft, sampleDraftFromNotes, ScriptedModel } from "../src/testing.js";

const ENERGY = {
  energy_certificate_type: "verbrauch",
  energy_value_kwh: 112,
  energy_carrier: "fernwaerme",
  energy_construction_year: 1962,
  energy_class: "D",
  energy_valid_until: "2032-05-31",
};

/** Notes, plan, photos and exposé present; rooms settled; energy certificate missing. */
function draftWithoutEnergy(): ListingDraft {
  const full = completeDraft();
  const d = sampleDraftFromNotes();
  d.plan = full.plan;
  d.photos = full.photos;
  d.expose = full.expose;
  d.set("rooms", 4, "broker");
  d.set("living_area_m2", 82.5, "floor_plan");
  return d;
}

function setup(draft: ListingDraft, answers: BrokerAnswer[] = []) {
  const asked: BrokerQuestion[] = [];
  const ctx: RunContext = {
    draft,
    photos: [],
    plan: { mediaType: "image/png", data: Buffer.from("") },
    visionModel: new ScriptedModel([]),
    askBroker: async (q) => {
      asked.push(q);
      const a = answers.shift();
      if (!a) throw new Error("no answer scripted");
      return a;
    },
    outDir: mkdtempSync(join(tmpdir(), "listing-")),
  };
  const tools = createTools(ctx);
  const run = (name: string, input: unknown = {}) => tools.find((t: Tool) => t.def.name === name)!.run(input, new AbortController().signal);
  return { ctx, asked, run };
}

test("export refuses while energy fields are missing", async () => {
  const { run } = setup(draftWithoutEnergy());
  const res = await run("export_openimmo");
  expect(res.isError).toBe(true);
  expect(res.content).toContain("energy_class");
});

test("export writes a valid file once everything is there", async () => {
  const { run, ctx } = setup(completeDraft());
  const res = await run("export_openimmo");
  expect(res.isError).toBeFalsy();
  expect(res.data).toMatchObject({ valid: true });
  expect(existsSync(join(ctx.outDir, "openimmo.xml"))).toBe(true);
  expect(existsSync(join(ctx.outDir, "expose-en.json"))).toBe(true);
});

test("ask_broker stores typed answers with source broker", async () => {
  const d = draftWithoutEnergy();
  const { run } = setup(d, [ENERGY]);
  const res = await run("ask_broker", { question: "Bitte Energieausweis-Daten angeben.", fields: Object.keys(ENERGY) });
  expect(res.isError).toBeFalsy();
  expect(d.get("energy_class")).toMatchObject({ value: "D", source: "broker" });
  expect(d.missing()).toEqual([]);
});

test("ask_broker re-asks when a field is blank or invalid and stores nothing", async () => {
  const d = draftWithoutEnergy();
  const { run, asked } = setup(d, [{ ...ENERGY, energy_value_kwh: "ca. 120", energy_carrier: "" }, ENERGY]);
  await run("ask_broker", { question: "Energieausweis?", fields: Object.keys(ENERGY) });
  expect(asked).toHaveLength(2);
  expect(asked[1]!.context).toContain("energy_value_kwh");
  expect(asked[1]!.context).toContain("energy_carrier");
  expect(d.get("energy_value_kwh")).toMatchObject({ value: 112, source: "broker" });
});

test("ask_broker rejects unknown fields", async () => {
  const { run, asked } = setup(draftWithoutEnergy());
  const res = await run("ask_broker", { question: "?", fields: ["parking_spaces"] });
  expect(res.isError).toBe(true);
  expect(asked).toHaveLength(0);
});

test("record_facts keeps valid facts and reports invalid ones", async () => {
  const d = new ListingDraft("3 Zimmer");
  const { run } = setup(d);
  const res = await run("record_facts", { facts: [{ field: "rooms", value: 3 }, { field: "floor", value: "zweite" }, { field: "pool", value: true }] });
  expect(d.get("rooms")).toMatchObject({ value: 3, source: "notes" });
  expect(res.content).toContain("floor");
  expect(res.content).toContain("pool");
});

test("submit_expose rejects an invented number, third failure aborts", async () => {
  const d = completeDraft();
  const expose = structuredClone(d.expose!);
  d.expose = undefined;
  expose.de.description = "Ca. 95 m² Wohnfläche.";
  const { run } = setup(d);
  const first = await run("submit_expose", expose);
  expect(first.isError).toBe(true);
  expect(first.content).toContain("95");
  expect(first.summary).toContain("95");
  expect(first.content).toMatch(/Februar 2027/);
  expect(first.content).toMatch(/sum|Summe|add/i);
  expect(d.expose).toBeUndefined();
  expect((await run("submit_expose", expose)).isError).toBe(true);
  await expect(run("submit_expose", expose)).rejects.toThrow(RunAbort);
});

test("submit_expose accepts text whose numbers are all in the record", async () => {
  const d = completeDraft();
  const expose = d.expose!;
  d.expose = undefined;
  const { run } = setup(d);
  const res = await run("submit_expose", expose);
  expect(res.isError).toBeFalsy();
  expect(d.expose).toEqual(expose);
});
