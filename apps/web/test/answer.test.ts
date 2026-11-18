import { expect, test } from "vitest";
import { parseAnswer } from "../src/answer";

const ENERGY = ["energy_certificate_type", "energy_value_kwh", "energy_carrier", "energy_construction_year", "energy_class", "energy_valid_until"] as const;

test("a valid energy form converts numbers and keeps enums and dates", () => {
  const r = parseAnswer([...ENERGY], {
    energy_certificate_type: "verbrauch",
    energy_value_kwh: "112,5",
    energy_carrier: "fernwaerme",
    energy_construction_year: "1962",
    energy_class: "D",
    energy_valid_until: "2032-05-31",
  });
  expect(r.errors).toEqual({});
  expect(r.answer).toEqual({
    energy_certificate_type: "verbrauch",
    energy_value_kwh: 112.5,
    energy_carrier: "fernwaerme",
    energy_construction_year: 1962,
    energy_class: "D",
    energy_valid_until: "2032-05-31",
  });
});

test("a blank field is an error and there is no answer", () => {
  const r = parseAnswer(["rooms"], { rooms: "  " });
  expect(r.answer).toBeUndefined();
  expect(r.errors.rooms).toBeTruthy();
});

test("free text in a number field is an error", () => {
  const r = parseAnswer(["energy_value_kwh"], { energy_value_kwh: "ca. 120" });
  expect(r.answer).toBeUndefined();
  expect(r.errors.energy_value_kwh).toMatch(/Zahl/);
});

test("German thousands separators are understood", () => {
  expect(parseAnswer(["price_cold_eur"], { price_cold_eur: "1.450" }).answer).toEqual({ price_cold_eur: 1450 });
});

test("booleans come from ja/nein", () => {
  expect(parseAnswer(["balcony"], { balcony: "ja" }).answer).toEqual({ balcony: true });
  expect(parseAnswer(["balcony"], { balcony: "nein" }).answer).toEqual({ balcony: false });
});
