import { fileURLToPath } from "node:url";
import { ListingDraft, type FloorPlan } from "./domain/draft.js";
import type { ModelClient, ModelRequest, ModelResponse, ScriptStep, Usage } from "./model.js";

export { call, say } from "./model.js";

/** A sharp 600×400 checker JPEG; the seed changes the cell size so hashes differ between photos. */
export async function checkerJpeg(r: number, g: number, b: number, seed = 1): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const w = 600;
  const h = 400;
  const cell = 7 + seed * 5;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const k = (Math.floor(x / cell) + Math.floor(y / (cell * 2))) % 2 ? 1 : 0.6;
      raw[i] = r * k;
      raw[i + 1] = g * k;
      raw[i + 2] = b * k;
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
}

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

/** A draft ready to export: notes facts, plan, photos, broker answers and an accepted exposé. */
export function completeDraft(): ListingDraft {
  const d = sampleDraftFromNotes();
  d.plan = planWith4Rooms;
  d.set("living_area_m2", 82.5, "floor_plan");
  d.set("rooms", 4, "broker");
  const energy: [Parameters<ListingDraft["set"]>[0], unknown][] = [
    ["energy_certificate_type", "verbrauch"],
    ["energy_value_kwh", 112],
    ["energy_carrier", "fernwaerme"],
    ["energy_construction_year", 1962],
    ["energy_class", "D"],
    ["energy_valid_until", "2032-05-31"],
  ];
  for (const [f, v] of energy) d.set(f, v, "broker");
  d.photos = {
    photos: [
      { id: "01-living", room: "living", features: ["parquet"], quality: "ok", reasons: [] },
      { id: "04-kitchen", room: "kitchen", features: ["built-in kitchen"], quality: "ok", reasons: [] },
      { id: "05-bedroom", room: "bedroom", features: [], quality: "ok", reasons: [] },
      { id: "14-dark", room: "living", features: [], quality: "poor", reasons: ["dark"] },
    ],
    order: ["01-living", "04-kitchen", "05-bedroom", "14-dark"],
    coverId: "01-living",
  };
  d.expose = {
    de: {
      title: "4-Zimmer-Wohnung mit Südbalkon in Eimsbüttel",
      description: "Helle 4-Zimmer-Wohnung im 2. OG mit 82,5 m² Wohnfläche. Die Einbauküche ist von 2023.",
      location: "Ruhige Seitenstraße in Eimsbüttel, 5 Min. zur U-Bahn Osterstraße, Park um die Ecke.",
      features: ["Einbauküche (2023)", "Balkon nach Süden", "Parkett", "Wanne im Bad"],
    },
    en: {
      title: "4-room flat with south-facing balcony in Eimsbüttel",
      description: "Bright 4-room flat on the 2nd floor with 82.5 m² of living space. The fitted kitchen is from 2023.",
      location: "Quiet side street in Eimsbüttel, 5 min to Osterstraße underground station, park around the corner.",
      features: ["Fitted kitchen (2023)", "South-facing balcony", "Parquet", "Bathtub"],
    },
  };
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
    // Copy the messages: the loop keeps appending to the same array after this call.
    this.requests.push({ ...request, messages: [...request.messages], signal: undefined });
    const step = this.steps[this.next++];
    if (!step) throw new Error(`ScriptedModel: no step ${this.next} scripted`);
    const content = typeof step === "function" ? step(request) : step;
    return { content, stop: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", usage: { ...this.usage } };
  }
}
