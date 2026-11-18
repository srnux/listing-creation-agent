import { readdirSync, readFileSync } from "node:fs";
import { extname, basename, join } from "node:path";
import sharp from "sharp";
import type { Block, ImageMediaType } from "../model.js";

export interface Photo {
  /** File name without extension, e.g. "01-living". */
  id: string;
  mediaType: ImageMediaType;
  data: Buffer;
}

export interface Measure {
  id: string;
  /** Mean luma, 0–255. */
  brightness: number;
  /** Variance of the Laplacian on a 512 px greyscale copy; low means blurry. */
  sharpness: number;
  /** 64-bit difference hash as hex; close hashes mean near-duplicates. */
  hash: string;
}

/** Tuned on the sample: the planted photos, and only those, are flagged. */
export const QUALITY_THRESHOLDS = { dark: 60, blur: 40, dupDistance: 10 };

const TYPES: Record<string, ImageMediaType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Every photo in a folder, sorted by file name. */
export function loadPhotos(dir: string): Photo[] {
  return readdirSync(dir)
    .filter((f) => extname(f).toLowerCase() in TYPES)
    .sort()
    .map((f) => ({ id: basename(f, extname(f)), mediaType: TYPES[extname(f).toLowerCase()]!, data: readFileSync(join(dir, f)) }));
}

export async function measurePhoto(photo: Photo): Promise<Measure> {
  const stats = await sharp(photo.data).greyscale().stats();
  const brightness = stats.channels[0]!.mean;

  const { data: lap } = await sharp(photo.data)
    .greyscale()
    .resize({ width: 512 })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sum = 0;
  let sq = 0;
  for (const v of lap) {
    sum += v;
    sq += v * v;
  }
  const mean = sum / lap.length;
  const sharpness = sq / lap.length - mean * mean;

  const { data: small } = await sharp(photo.data).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (small[y * 9 + x]! > small[y * 9 + x + 1]! ? 1n : 0n);

  return { id: photo.id, brightness, sharpness, hash: bits.toString(16).padStart(16, "0") };
}

const hamming = (a: string, b: string) => {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

/** Flags per photo id: "dark", "blurry", "duplicate_of:<earlier id>". */
export function flagPhotos(measures: Measure[], t = QUALITY_THRESHOLDS): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  measures.forEach((m, i) => {
    const flags: string[] = [];
    if (m.brightness < t.dark) flags.push("dark");
    if (m.sharpness < t.blur) flags.push("blurry");
    const dup = measures.slice(0, i).find((e) => hamming(e.hash, m.hash) <= t.dupDistance);
    if (dup) flags.push(`duplicate_of:${dup.id}`);
    out[m.id] = flags;
  });
  return out;
}

/** The photo as Bedrock gets it: long edge 1568 px, JPEG quality 80. */
export async function prepareForModel(photo: Photo): Promise<Block> {
  const buf = await sharp(photo.data).rotate().resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: false }).jpeg({ quality: 80 }).toBuffer();
  return { type: "image", mediaType: "image/jpeg", data: buf.toString("base64") };
}
