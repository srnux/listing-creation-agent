import "../src/env.js";
import { readFileSync } from "node:fs";
import { analyzePhotos, loadPhotos, readFloorPlan } from "@listing/core";
import { SAMPLE_DIR } from "@listing/core/testing";
import { expect, test } from "vitest";
import { BedrockModel, DEFAULT_VISION } from "../src/bedrock.js";

// Live on Bedrock: LIVE=1 pnpm vitest run vision-live
const live = process.env.LIVE === "1";
const vision = () => new BedrockModel({ model: process.env.VISION_MODEL ?? DEFAULT_VISION });

test.skipIf(!live)("analyses the sample photos and flags the planted ones", { timeout: 180_000 }, async () => {
  const started = performance.now();
  const r = await analyzePhotos(vision(), loadPhotos(`${SAMPLE_DIR}photos`));
  console.log(`photos: ${Math.round(performance.now() - started)} ms`, JSON.stringify(r, null, 1));
  expect(r.photos).toHaveLength(16);
  const poor = r.photos.filter((p) => p.quality === "poor").map((p) => p.id);
  expect(poor).toEqual(expect.arrayContaining(["14-dark", "15-blurry", "16-duplicate"]));
  expect(poor).not.toContain(r.coverId);
});

test.skipIf(!live)("reads the sample floor plan", { timeout: 120_000 }, async () => {
  const started = performance.now();
  const plan = await readFloorPlan(vision(), { mediaType: "image/png", data: readFileSync(`${SAMPLE_DIR}floorplan.png`) });
  console.log(`plan: ${Math.round(performance.now() - started)} ms`, JSON.stringify(plan));
  expect(plan.roomCount).toBe(4);
  expect(plan.totalLivingArea_m2).toBeCloseTo(82.5, 0);
});
