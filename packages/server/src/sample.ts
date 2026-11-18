import { readFileSync } from "node:fs";
import { loadPhotos, type BrokerAnswer, type FieldId, type PlanFile, type Photo } from "@listing/core";
import { SAMPLE_DIR } from "@listing/core/testing";

export interface ListingInput {
  notes: string;
  photos: Photo[];
  plan: PlanFile;
}

export const loadTone = (): string => readFileSync(`${SAMPLE_DIR}agency-tone.md`, "utf8");

export function loadSample(): ListingInput {
  return {
    notes: readFileSync(`${SAMPLE_DIR}notes.txt`, "utf8").trim(),
    photos: loadPhotos(`${SAMPLE_DIR}photos`),
    plan: { mediaType: "image/png", data: readFileSync(`${SAMPLE_DIR}floorplan.png`) },
  };
}

/** What the broker answers for the sample flat (used by `pnpm sample --auto` and to prefill replay forms). */
export const SAMPLE_ANSWERS: Partial<Record<FieldId, unknown>> = {
  rooms: 4,
  living_area_m2: 82.5,
  balcony: true,
  energy_certificate_type: "verbrauch",
  energy_value_kwh: 112,
  energy_carrier: "fernwaerme",
  energy_construction_year: 1962,
  energy_class: "D",
  energy_valid_until: "2032-05-31",
};

export const sampleAnswer = (fields: FieldId[]): BrokerAnswer => Object.fromEntries(fields.map((f) => [f, SAMPLE_ANSWERS[f]]));
