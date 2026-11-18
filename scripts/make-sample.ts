import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Plants the photos the agent should flag, and renders the floor plan. Run: pnpm make-sample
const dir = fileURLToPath(new URL("../data/sample/", import.meta.url));
const photo = (name: string) => `${dir}photos/${name}.jpg`;

const jobs: [string, () => Promise<unknown>][] = [
  ["photos/14-dark.jpg", () => sharp(photo("02-living")).modulate({ brightness: 0.25 }).jpeg({ quality: 85 }).toFile(photo("14-dark"))],
  ["photos/15-blurry.jpg", () => sharp(photo("05-bedroom")).blur(12).jpeg({ quality: 85 }).toFile(photo("15-blurry"))],
  [
    "photos/16-duplicate.jpg",
    async () => {
      const { width = 0, height = 0 } = await sharp(photo("01-living")).metadata();
      const dx = Math.round(width * 0.02);
      const dy = Math.round(height * 0.02);
      return sharp(photo("01-living"))
        .extract({ left: dx, top: dy, width: width - 2 * dx, height: height - 2 * dy })
        .jpeg({ quality: 80 })
        .toFile(photo("16-duplicate"));
    },
  ],
  ["floorplan.png", () => sharp(`${dir}floorplan.svg`, { density: 160 }).resize({ width: 1600 }).png().toFile(`${dir}floorplan.png`)],
];

for (const [name, job] of jobs) {
  await job();
  console.log(`${name.padEnd(24)} ${Math.round(statSync(`${dir}${name}`).size / 1024)} KB`);
}
