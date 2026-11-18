import sharp from "sharp";
import { expect, test } from "vitest";
import { readFloorPlan } from "../src/floorplan/read.js";
import { analyzePhotos } from "../src/photos/analyze.js";
import type { Photo } from "../src/photos/quality.js";
import { call, ScriptedModel } from "../src/testing.js";

/** A sharp 600×400 test image: a checker pattern whose cell size varies by seed, so hashes differ. */
const jpeg = async (r: number, g: number, b: number, seed = 1): Promise<Buffer> => {
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
};

test("code flags override the model's quality verdict and the cover", async () => {
  const photoA: Photo = { id: "a", mediaType: "image/jpeg", data: await jpeg(200, 190, 180) };
  const darkB: Photo = { id: "b", mediaType: "image/jpeg", data: await jpeg(20, 20, 20, 3) };
  const model = new ScriptedModel([
    (req) => {
      expect(req.toolChoice).toEqual({ name: "report_photos" });
      const content = req.messages[0]!.content as { type: string; text?: string }[];
      expect(content.filter((b) => b.type === "image")).toHaveLength(2);
      expect(content.some((b) => b.text?.includes("Photo b") && b.text.includes("dark"))).toBe(true);
      return [
        call("report_photos", {
          photos: [
            { id: "a", room: "living", features: ["parquet"], quality: "ok", reasons: [] },
            { id: "b", room: "living", features: [], quality: "ok", reasons: [] },
          ],
          order: ["b", "a"],
          coverId: "b",
        }),
      ];
    },
  ]);
  const r = await analyzePhotos(model, [photoA, darkB]);
  expect(r.photos.find((p) => p.id === "b")).toMatchObject({ quality: "poor", reasons: expect.arrayContaining(["dark"]) });
  expect(r.coverId).toBe("a");
  expect(r.order).toEqual(["a", "b"]);
});

test("photos the model leaves out are added to the order", async () => {
  const photos: Photo[] = [
    { id: "a", mediaType: "image/jpeg", data: await jpeg(200, 190, 180) },
    { id: "c", mediaType: "image/jpeg", data: await jpeg(120, 160, 200, 6) },
  ];
  const model = new ScriptedModel([
    [
      call("report_photos", {
        photos: [{ id: "a", room: "kitchen", features: [], quality: "ok", reasons: [] }],
        order: ["a", "zzz"],
        coverId: "a",
      }),
    ],
  ]);
  const r = await analyzePhotos(model, photos);
  expect(r.order).toEqual(["a", "c"]);
  expect(r.photos.map((p) => p.id)).toEqual(["a", "c"]);
});

test("roomCount is computed from room types, not taken from the model", async () => {
  const model = new ScriptedModel([
    [
      call("report_floor_plan", {
        rooms: [
          { name: "Wohnzimmer", type: "living", area_m2: 24.5 },
          { name: "Schlafzimmer", type: "bedroom", area_m2: 16 },
          { name: "Kinderzimmer", type: "bedroom", area_m2: 12.5 },
          { name: "Arbeitszimmer", type: "study", area_m2: 9 },
          { name: "Küche", type: "kitchen", area_m2: 8.5 },
          { name: "Bad", type: "bathroom", area_m2: 5 },
          { name: "Balkon", type: "balcony", area_m2: 5 },
        ],
        totalLivingArea_m2: 82.5,
      }),
    ],
  ]);
  const plan = await readFloorPlan(model, { mediaType: "image/png", data: Buffer.from("x") });
  expect(plan.roomCount).toBe(4);
  expect(plan.hasBalcony).toBe(true);
  expect(plan.totalLivingArea_m2).toBe(82.5);
});
