import { z } from "zod";
import { ROOM_TYPES, type FloorPlan, type RoomType } from "../domain/draft.js";
import { structuredCall, type Block, type ModelClient } from "../model.js";

export interface PlanFile {
  mediaType: "image/png" | "image/jpeg" | "application/pdf";
  data: Buffer;
}

const Report = z.object({
  rooms: z.array(
    z.object({
      name: z.string().describe("the room's label as written on the plan"),
      type: z.enum(ROOM_TYPES),
      area_m2: z.number().nonnegative().describe("the area as written on the plan"),
    }),
  ),
  totalLivingArea_m2: z.number().positive().describe("total living area if written on the plan; otherwise the sum of the room areas"),
});

const SYSTEM = `You read floor plans of flats for a real-estate broker.
Extract every room with its type and its area exactly as written on the plan. Do not estimate areas that are not written.
Use type "living" for the living room, "bedroom" for bedrooms and children's rooms, "study" for an office or study.
Report the total living area as written on the plan.`;

/** Counted as rooms in German listings ("Zimmer"): not kitchen, bath, hallway or balcony. */
const ROOM_COUNTED: RoomType[] = ["living", "bedroom", "study"];

export async function readFloorPlan(model: ModelClient, plan: PlanFile, signal?: AbortSignal): Promise<FloorPlan> {
  const file: Block =
    plan.mediaType === "application/pdf"
      ? { type: "document", mediaType: "application/pdf", data: plan.data.toString("base64") }
      : { type: "image", mediaType: plan.mediaType, data: plan.data.toString("base64") };
  const report = await structuredCall(model, {
    system: SYSTEM,
    content: [file, { type: "text", text: "Extract the rooms from this floor plan." }],
    toolName: "report_floor_plan",
    description: "Report the rooms on the floor plan with type and area, and the total living area.",
    schema: Report,
    maxTokens: 4_000,
    signal,
  });
  return {
    rooms: report.rooms,
    roomCount: report.rooms.filter((r) => ROOM_COUNTED.includes(r.type)).length,
    totalLivingArea_m2: report.totalLivingArea_m2,
    hasBalcony: report.rooms.some((r) => r.type === "balcony"),
  };
}
