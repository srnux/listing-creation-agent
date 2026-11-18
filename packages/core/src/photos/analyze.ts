import { z } from "zod";
import { ROOM_TYPES, type PhotoAnalysis, type RoomType } from "../domain/draft.js";
import { structuredCall, type Block, type ModelClient } from "../model.js";
import { flagPhotos, measurePhoto, prepareForModel, type Photo } from "./quality.js";

const Report = z.object({
  photos: z.array(
    z.object({
      id: z.string(),
      room: z.enum(ROOM_TYPES),
      features: z.array(z.string()).describe("visible features, English lowercase, e.g. parquet, built-in kitchen, bathtub, balcony"),
      quality: z.enum(["ok", "poor"]),
      reasons: z.array(z.string()).describe("why a photo is poor; empty when ok"),
    }),
  ),
  order: z.array(z.string()).describe("photo ids in the order a buyer should see them"),
  coverId: z.string().describe("the best photo to lead the listing"),
});

const SYSTEM = `You review photos a real-estate broker took of one flat.
For every photo: identify the room, list visible features (parquet, built-in kitchen, bathtub, shower, balcony, herringbone floor, high ceilings, ...) in English lowercase, and judge whether it is good enough for a listing.
Each photo is preceded by its id and the flags that checks in code found (dark, blurry, duplicate_of:<id>). Treat flagged photos as poor.
Suggest an order that walks a buyer through the flat, starting with the best living-room or exterior shot, and pick the cover photo.
Report only what you can see. Do not guess features that are not visible.`;

const COVER_ROOMS: RoomType[] = ["living", "exterior"];

/** One vision call over all photos, then code enforces the quality flags, the order and the cover. */
export async function analyzePhotos(model: ModelClient, photos: Photo[], signal?: AbortSignal): Promise<PhotoAnalysis> {
  const flags = flagPhotos(await Promise.all(photos.map(measurePhoto)));
  const content: Block[] = [];
  for (const p of photos) {
    const f = flags[p.id] ?? [];
    content.push({ type: "text", text: `Photo ${p.id} — code flags: ${f.length ? f.join(", ") : "none"}` });
    content.push(await prepareForModel(p));
  }
  content.push({ type: "text", text: `Report on all ${photos.length} photos.` });

  const report = await structuredCall(model, {
    system: SYSTEM,
    content,
    toolName: "report_photos",
    description: "Report room, features and quality per photo, the suggested order and the cover photo.",
    schema: Report,
    maxTokens: 8_000,
    signal,
  });

  const byId = new Map(report.photos.map((p) => [p.id, p]));
  const analysed: PhotoAnalysis["photos"] = photos.map((p) => {
    const r = byId.get(p.id) ?? { id: p.id, room: "other" as const, features: [], quality: "ok" as const, reasons: [] };
    const codeFlags = flags[p.id] ?? [];
    const reasons = [...new Set([...codeFlags, ...r.reasons])];
    return { id: p.id, room: r.room, features: r.features, quality: codeFlags.length || r.quality === "poor" ? "poor" : "ok", reasons: codeFlags.length || r.quality === "poor" ? reasons : [] };
  });

  const known = new Set(photos.map((p) => p.id));
  const suggested = [...new Set(report.order.filter((id) => known.has(id)))];
  const all = [...suggested, ...photos.map((p) => p.id).filter((id) => !suggested.includes(id))];
  const poor = new Set(analysed.filter((p) => p.quality === "poor").map((p) => p.id));
  const order = [...all.filter((id) => !poor.has(id)), ...all.filter((id) => poor.has(id))];

  const room = new Map(analysed.map((p) => [p.id, p.room]));
  const coverOk = known.has(report.coverId) && !poor.has(report.coverId);
  const coverId = coverOk
    ? report.coverId
    : (order.find((id) => !poor.has(id) && COVER_ROOMS.includes(room.get(id)!)) ?? order.find((id) => !poor.has(id)) ?? order[0]!);

  return { photos: analysed, order, coverId };
}
