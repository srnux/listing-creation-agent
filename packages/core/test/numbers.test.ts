import { expect, test } from "vitest";
import { checkNumbers } from "../src/guards/numbers.js";

const known = new Set([3, 2, 1450, 2023, 78, 5]);

test.each([
  "3-Zimmer-Wohnung im 2. OG",
  "Kaltmiete 1.450 €",
  "€1,450 cold",
  "Baujahr der Küche: 2023",
  "1 Balkon",
  "78 m²",
  "5 Minuten zur U-Bahn",
  "0 Stufen",
])("passes %s", (t) => expect(checkNumbers([t], known)).toEqual([]));

test("flags an invented area with its context", () => {
  const found = checkNumbers(["ca. 65 m² Wohnfläche"], known);
  expect(found.map((f) => f.raw)).toEqual(["65"]);
  expect(found[0]!.context).toContain("65 m²");
});

test("flags across DE and EN texts", () => {
  expect(checkNumbers(["4 Zimmer", "built 1998"], known).map((f) => f.raw)).toEqual(["4", "1998"]);
});
