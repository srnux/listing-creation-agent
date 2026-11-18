import { expect, test } from "vitest";
import { flagPhotos, loadPhotos, measurePhoto, prepareForModel } from "../src/photos/quality.js";
import { SAMPLE_DIR } from "../src/testing.js";

test("flags exactly the planted photos in the sample", async () => {
  const measures = await Promise.all(loadPhotos(`${SAMPLE_DIR}photos`).map(measurePhoto));
  const flags = flagPhotos(measures);
  expect(Object.entries(flags).filter(([, f]) => f.length)).toEqual([
    ["14-dark", ["dark", "duplicate_of:02-living"]],
    ["15-blurry", ["blurry", "duplicate_of:05-bedroom"]],
    ["16-duplicate", ["duplicate_of:01-living"]],
  ]);
});

test("prepareForModel resizes to a 1568 px long edge JPEG", async () => {
  const [photo] = loadPhotos(`${SAMPLE_DIR}photos`);
  const block = await prepareForModel(photo!);
  expect(block).toMatchObject({ type: "image", mediaType: "image/jpeg" });
  const sharp = (await import("sharp")).default;
  const meta = await sharp(Buffer.from((block as { data: string }).data, "base64")).metadata();
  expect(Math.max(meta.width!, meta.height!)).toBe(1568);
});
