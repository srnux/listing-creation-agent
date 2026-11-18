import type { ListingDraft, Source } from "./draft.js";
import type { FieldId } from "./fields.js";

export interface Conflict {
  field: FieldId;
  values: { source: Source; value: unknown }[];
  message: string;
}

const AREA_TOLERANCE = 0.03;

/** Compares notes against the floor plan and photos. A field the broker already answered is settled. */
export function compareSources(draft: ListingDraft): Conflict[] {
  const out: Conflict[] = [];
  const unsettled = (field: FieldId) => {
    const f = draft.get(field);
    return f && f.source !== "broker" ? f : undefined;
  };
  const plan = draft.plan;

  const rooms = unsettled("rooms");
  if (rooms && plan && rooms.value !== plan.roomCount) {
    out.push({
      field: "rooms",
      values: [
        { source: rooms.source, value: rooms.value },
        { source: "floor_plan", value: plan.roomCount },
      ],
      message: `The ${rooms.source} say ${rooms.value} rooms, the floor plan shows ${plan.roomCount}.`,
    });
  }

  const balcony = unsettled("balcony");
  if (balcony && plan) {
    const photoBalcony = draft.photos?.photos.some((p) => p.room === "balcony" || p.features.includes("balcony")) ?? false;
    const seen = plan.hasBalcony || photoBalcony;
    if (balcony.value !== seen) {
      out.push({
        field: "balcony",
        values: [
          { source: balcony.source, value: balcony.value },
          { source: "floor_plan", value: plan.hasBalcony },
        ],
        message: balcony.value
          ? `The ${balcony.source} mention a balcony, but neither the floor plan nor the photos show one.`
          : `The ${balcony.source} mention no balcony, but the floor plan or photos show one.`,
      });
    }
  }

  const area = unsettled("living_area_m2");
  if (area && area.source !== "floor_plan" && plan) {
    const a = area.value as number;
    if (Math.abs(a - plan.totalLivingArea_m2) / plan.totalLivingArea_m2 > AREA_TOLERANCE) {
      out.push({
        field: "living_area_m2",
        values: [
          { source: area.source, value: a },
          { source: "floor_plan", value: plan.totalLivingArea_m2 },
        ],
        message: `The ${area.source} say ${a} m², the floor plan adds up to ${plan.totalLivingArea_m2} m².`,
      });
    }
  }
  return out;
}
