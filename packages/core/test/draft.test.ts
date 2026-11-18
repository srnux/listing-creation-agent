import { expect, test } from "vitest";
import { compareSources } from "../src/domain/compare.js";
import { FieldError, ListingDraft } from "../src/domain/draft.js";
import { planWith4Rooms, sampleDraftFromNotes } from "../src/testing.js";

test("set rejects wrong types and unknown enum values", () => {
  const d = new ListingDraft("notes");
  expect(() => d.set("rooms", "three", "notes")).toThrow(FieldError);
  expect(() => d.set("energy_class", "Z", "broker")).toThrow(FieldError);
});

test("missing lists the six energy fields when notes and plan facts exist", () => {
  const d = sampleDraftFromNotes();
  d.set("living_area_m2", 82.5, "floor_plan");
  expect(d.missing()).toEqual([
    "energy_certificate_type",
    "energy_value_kwh",
    "energy_carrier",
    "energy_construction_year",
    "energy_class",
    "energy_valid_until",
  ]);
});

test("broker answer overrides notes and the room conflict disappears", () => {
  const d = sampleDraftFromNotes();
  d.plan = planWith4Rooms;
  expect(compareSources(d).map((c) => c.field)).toEqual(["rooms"]);
  d.set("rooms", 4, "broker");
  expect(d.get("rooms")).toMatchObject({ value: 4, source: "broker" });
  expect(compareSources(d)).toEqual([]);
});

test("a balcony in the notes but none on the plan is a conflict", () => {
  const d = sampleDraftFromNotes();
  d.plan = { ...planWith4Rooms, hasBalcony: false };
  d.set("rooms", 4, "broker");
  expect(compareSources(d).map((c) => c.field)).toEqual(["balcony"]);
});

test("living area differing by more than 3 % from the plan is a conflict", () => {
  const d = sampleDraftFromNotes();
  d.plan = planWith4Rooms;
  d.set("rooms", 4, "broker");
  d.set("living_area_m2", 75, "notes");
  expect(compareSources(d).map((c) => c.field)).toEqual(["living_area_m2"]);
  d.set("living_area_m2", 82, "notes");
  expect(compareSources(d)).toEqual([]);
});

test("knownNumbers includes notes numbers, location fact numbers and plan areas", () => {
  const d = sampleDraftFromNotes();
  d.plan = planWith4Rooms;
  const known = d.knownNumbers();
  expect(known.has(1450)).toBe(true);
  expect(known.has(5)).toBe(true);
  expect(known.has(24.5)).toBe(true);
  expect(known.has(82.5)).toBe(true);
  expect(known.has(999)).toBe(false);
});
