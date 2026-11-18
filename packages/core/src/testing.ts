import { fileURLToPath } from "node:url";
import { ListingDraft, type FloorPlan } from "./domain/draft.js";
import type { ModelClient, ModelRequest, ModelResponse, ScriptStep, Usage } from "./model.js";

export { call, say } from "./model.js";

/** Absolute path to data/sample (photos/, floorplan.png, notes.txt, agency-tone.md). */
export const SAMPLE_DIR = fileURLToPath(new URL("../../../data/sample/", import.meta.url));

export const SAMPLE_NOTES =
  "3 Zimmer, 2. OG, Küche neu 2023, Balkon Süd, 1.450 € kalt, NK 220 €.\n" +
  "Musterstraße 12, 20255 Hamburg-Eimsbüttel. Ruhige Seitenstraße, 5 Min. zur U-Bahn Osterstraße, Park um die Ecke.\n" +
  "Parkett, Wanne im Bad. Frei ab 1.2.2027.";

/** The facts an agent would record from the sample notes. */
export function sampleDraftFromNotes(): ListingDraft {
  const d = new ListingDraft(SAMPLE_NOTES);
  const facts: [Parameters<ListingDraft["set"]>[0], unknown][] = [
    ["rooms", 3],
    ["floor", 2],
    ["kitchen_year", 2023],
    ["built_in_kitchen", true],
    ["balcony", true],
    ["balcony_orientation", "south"],
    ["price_cold_eur", 1450],
    ["service_charges_eur", 220],
    ["street", "Musterstraße 12"],
    ["postal_code", "20255"],
    ["city", "Hamburg"],
    ["district", "Eimsbüttel"],
    ["location_facts", ["Ruhige Seitenstraße", "5 Min. zur U-Bahn Osterstraße", "Park um die Ecke"]],
    ["available_from", "2027-02-01"],
  ];
  for (const [field, value] of facts) d.set(field, value, "notes");
  return d;
}

export const planWith4Rooms: FloorPlan = {
  rooms: [
    { name: "Wohnzimmer", type: "living", area_m2: 24.5 },
    { name: "Schlafzimmer", type: "bedroom", area_m2: 16 },
    { name: "Kinderzimmer", type: "bedroom", area_m2: 12.5 },
    { name: "Arbeitszimmer", type: "study", area_m2: 9 },
    { name: "Küche", type: "kitchen", area_m2: 8.5 },
    { name: "Bad", type: "bathroom", area_m2: 5 },
    { name: "Flur", type: "hallway", area_m2: 4.5 },
    { name: "Balkon", type: "balcony", area_m2: 2.5 },
  ],
  roomCount: 4,
  totalLivingArea_m2: 82.5,
  hasBalcony: true,
};

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
