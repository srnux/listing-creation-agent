import { expect, test } from "vitest";
import { buildOpenImmo } from "../src/openimmo/build.js";
import { validateOpenImmo } from "../src/openimmo/validate.js";
import { completeDraft } from "../src/testing.js";

const opts = {
  anbieterId: "LINDENHOF",
  objektId: "LH-2026-001",
  photoFiles: Object.fromEntries(["01-living", "04-kitchen", "05-bedroom", "14-dark"].map((id) => [id, `photos/${id}.jpg`])),
};

test("complete sample draft builds and validates", async () => {
  const xml = buildOpenImmo(completeDraft(), opts);
  const r = await validateOpenImmo(xml);
  expect(r.errors).toEqual([]);
  expect(r.valid).toBe(true);
});

test("cover is TITELBILD, poor photos are excluded, order is kept", () => {
  const xml = buildOpenImmo(completeDraft(), opts);
  const anhaenge = [...xml.matchAll(/<anhang [^>]*gruppe="(\w+)"[\s\S]*?<pfad>([^<]+)<\/pfad>/g)].map((m) => [m[1], m[2]]);
  expect(anhaenge).toEqual([
    ["TITELBILD", "photos/01-living.jpg"],
    ["BILD", "photos/04-kitchen.jpg"],
    ["BILD", "photos/05-bedroom.jpg"],
  ]);
});

test("kaltmiete, wohnflaeche and the energy certificate carry the draft values", () => {
  const xml = buildOpenImmo(completeDraft(), opts);
  expect(xml).toContain("<kaltmiete>1450</kaltmiete>");
  expect(xml).toContain("<wohnflaeche>82.5</wohnflaeche>");
  expect(xml).toContain("<anzahl_zimmer>4</anzahl_zimmer>");
  expect(xml).toContain("<epart>VERBRAUCH</epart>");
  expect(xml).toContain("<energieverbrauchkennwert>112</energieverbrauchkennwert>");
  expect(xml).toContain("<wertklasse>D</wertklasse>");
  expect(xml).toContain("<objekttitel>");
});

test("validation reports errors on a broken document", async () => {
  const r = await validateOpenImmo("<openimmo/>");
  expect(r.valid).toBe(false);
  expect(r.errors.length).toBeGreaterThan(0);
});

test("validation reports a missing energy certificate", async () => {
  const xml = buildOpenImmo(completeDraft(), opts).replace(/<energiepass>[\s\S]*<\/energiepass>/, "");
  const r = await validateOpenImmo(xml);
  expect(r.valid).toBe(false);
  expect(r.errors.join(" ")).toContain("energiepass");
});
