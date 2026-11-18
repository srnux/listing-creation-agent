import { z } from "zod";
import { numbersIn } from "../guards/numbers.js";
import { FIELD_SCHEMAS, REQUIRED_FIELDS, type FieldId } from "./fields.js";

export type Source = "notes" | "floor_plan" | "broker" | `photo:${string}`;

export interface Fact {
  field: FieldId;
  value: unknown;
  source: Source;
}

export const ROOM_TYPES = ["living", "bedroom", "study", "kitchen", "bathroom", "hallway", "balcony", "exterior", "other"] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

export interface FloorPlan {
  rooms: { name: string; type: RoomType; area_m2: number }[];
  roomCount: number;
  totalLivingArea_m2: number;
  hasBalcony: boolean;
}

export interface PhotoAnalysis {
  photos: { id: string; room: RoomType; features: string[]; quality: "ok" | "poor"; reasons: string[] }[];
  order: string[];
  coverId: string;
}

export interface ExposeText {
  title: string;
  description: string;
  location: string;
  features: string[];
}
export type Expose = Record<"de" | "en", ExposeText>;

export interface DraftSnapshot {
  notes: string;
  facts: Fact[];
  photos?: PhotoAnalysis;
  plan?: FloorPlan;
  expose?: Expose;
}

export class FieldError extends Error {
  override name = "FieldError";
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`${field}: ${message}`);
  }
}

/** Validates a value against the field's schema; returns the parsed value or throws FieldError. */
export function parseField(field: string, value: unknown): unknown {
  if (!(field in FIELD_SCHEMAS)) throw new FieldError(field, "unknown field");
  const parsed = FIELD_SCHEMAS[field as FieldId].safeParse(value);
  if (!parsed.success) throw new FieldError(field, z.prettifyError(parsed.error).replace(/\n/g, " "));
  return parsed.data;
}

/** The record: every fact with its source. The model never holds the only copy of a fact. */
export class ListingDraft {
  private readonly current = new Map<FieldId, Fact>();
  readonly history: Fact[] = [];
  photos?: PhotoAnalysis;
  plan?: FloorPlan;
  expose?: Expose;

  constructor(readonly notes: string) {}

  set(field: FieldId, value: unknown, source: Source): void {
    const parsed = parseField(field, value);
    const old = this.current.get(field);
    if (old) this.history.push(old);
    this.current.set(field, { field, value: parsed, source });
  }

  get(field: FieldId): Fact | undefined {
    return this.current.get(field);
  }

  value<T = unknown>(field: FieldId): T | undefined {
    return this.current.get(field)?.value as T | undefined;
  }

  facts(): Fact[] {
    return [...this.current.values()];
  }

  missing(): FieldId[] {
    return REQUIRED_FIELDS.filter((f) => !this.current.has(f));
  }

  /** Every number the exposé may state: fact values, numbers inside text facts, plan areas, and the notes. */
  knownNumbers(): Set<number> {
    const out = new Set<number>();
    const add = (v: unknown) => {
      if (typeof v === "number") out.add(v);
      else if (typeof v === "string") numbersIn(v).forEach((n) => out.add(n));
      else if (Array.isArray(v)) v.forEach(add);
    };
    for (const f of this.current.values()) add(f.value);
    if (this.plan) {
      this.plan.rooms.forEach((r) => out.add(r.area_m2));
      out.add(this.plan.totalLivingArea_m2);
      out.add(this.plan.roomCount);
    }
    numbersIn(this.notes).forEach((n) => out.add(n));
    return out;
  }

  snapshot(): DraftSnapshot {
    return { notes: this.notes, facts: this.facts(), photos: this.photos, plan: this.plan, expose: this.expose };
  }
}
