import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { compareSources } from "../domain/compare.js";
import { FieldError, parseField, type ListingDraft } from "../domain/draft.js";
import { FIELD_IDS, FIELD_LABELS, isFieldId, type FieldId } from "../domain/fields.js";
import { readFloorPlan, type PlanFile } from "../floorplan/read.js";
import { checkNumbers } from "../guards/numbers.js";
import { jsonSchema, type ModelClient, type ToolDef } from "../model.js";
import { buildOpenImmo } from "../openimmo/build.js";
import { validateOpenImmo } from "../openimmo/validate.js";
import { analyzePhotos } from "../photos/analyze.js";
import type { Photo } from "../photos/quality.js";
import type { BrokerAnswer, BrokerQuestion, RunEvent } from "./events.js";

export type { BrokerAnswer, BrokerQuestion } from "./events.js";

export interface RunContext {
  draft: ListingDraft;
  photos: Photo[];
  plan: PlanFile;
  visionModel: ModelClient;
  askBroker(q: BrokerQuestion): Promise<BrokerAnswer>;
  outDir: string;
  /** Set by the loop: question and answer events for the page. */
  emit?: (e: RunEvent) => void;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
  /** Structured result for the page. */
  data?: unknown;
  /** One line for the step list. */
  summary?: string;
}

export interface Tool {
  def: ToolDef;
  run(input: unknown, signal: AbortSignal): Promise<ToolResult>;
  /** Exempt from the per-tool timeout (waits for a person). */
  noTimeout?: boolean;
}

/** Ends the run: something the agent cannot repair. */
export class RunAbort extends Error {
  override name = "RunAbort";
}

const EXPOSE_REPAIRS = 1;
const ASK_ATTEMPTS = 3;

const ok = (data: unknown, summary: string): ToolResult => ({ content: JSON.stringify(data), data, summary });
const fail = (message: string, data?: unknown): ToolResult => ({ content: message, isError: true, data, summary: message.split("\n")[0]!.slice(0, 160) });

const ExposeText = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(20),
  location: z.string().min(10),
  features: z.array(z.string().min(2)).min(1),
});
const Expose = z.object({ de: ExposeText, en: ExposeText });

const RecordFacts = z.object({
  facts: z.array(z.object({ field: z.string(), value: z.unknown() })).min(1),
});
const AskBroker = z.object({
  question: z.string().min(3).describe("The question in German, one or two sentences, as the broker will read it."),
  fields: z.array(z.string()).min(1).describe(`Draft field ids the answer fills. Known ids: ${FIELD_IDS.join(", ")}`),
  context: z.string().optional().describe("What you found that makes you ask (e.g. the conflicting values)."),
});
const Empty = z.object({});

function def(name: string, description: string, schema: z.ZodType): ToolDef {
  return { name, description, inputSchema: jsonSchema(schema) };
}

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> | ToolResult {
  const parsed = schema.safeParse(input);
  return parsed.success ? parsed.data : fail(`Invalid input: ${z.prettifyError(parsed.error)}`);
}
const isResult = (x: unknown): x is ToolResult => typeof x === "object" && x !== null && "content" in x && "summary" in x;

/** The agent's tools. The rules live here, in code: the model cannot talk its way past them. */
export function createTools(ctx: RunContext): Tool[] {
  const { draft } = ctx;
  let exposeFailures = 0;
  let questionNo = 0;

  const tools: Tool[] = [
    {
      def: def(
        "record_facts",
        "Record facts you read in the broker's notes into the listing draft (source: notes). Use the field ids from the schema; " +
          "numbers as numbers, booleans as booleans, dates as YYYY-MM-DD, location_facts as a list of short phrases. " +
          `Known fields: ${FIELD_IDS.join(", ")}. Record only what the notes say.`,
        RecordFacts,
      ),
      async run(input) {
        const p = parseInput(RecordFacts, input);
        if (isResult(p)) return p;
        const stored: string[] = [];
        const errors: string[] = [];
        for (const { field, value } of p.facts) {
          try {
            if (!isFieldId(field)) throw new FieldError(field, "unknown field");
            draft.set(field, value, "notes");
            stored.push(field);
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        }
        const data = { stored, errors };
        return errors.length
          ? { content: JSON.stringify(data), data, isError: stored.length === 0, summary: `${stored.length} facts, ${errors.length} rejected` }
          : ok(data, `${stored.length} facts: ${stored.join(", ")}`);
      },
    },
    {
      def: def(
        "analyze_photos",
        "Analyse all uploaded photos: room per photo, visible features, quality (dark, blurry, duplicate photos are flagged by code), " +
          "suggested order and cover photo. Call once.",
        Empty,
      ),
      async run(_input, signal) {
        const result = await analyzePhotos(ctx.visionModel, ctx.photos, signal);
        draft.photos = result;
        const kitchen = result.photos.find((p) => p.features.some((f) => /built-in kitchen|fitted kitchen/.test(f)));
        if (kitchen && !draft.get("built_in_kitchen")) draft.set("built_in_kitchen", true, `photo:${kitchen.id}`);
        const balcony = result.photos.find((p) => p.room === "balcony");
        if (balcony && !draft.get("balcony")) draft.set("balcony", true, `photo:${balcony.id}`);
        const poor = result.photos.filter((p) => p.quality === "poor");
        return ok(result, `${result.photos.length} photos, ${poor.length} poor (${poor.map((p) => p.id).join(", ") || "none"}), cover ${result.coverId}`);
      },
    },
    {
      def: def("read_floor_plan", "Read the uploaded floor plan: rooms with type and area, room count, total living area. Call once.", Empty),
      async run(_input, signal) {
        const plan = await readFloorPlan(ctx.visionModel, ctx.plan, signal);
        draft.plan = plan;
        if (!draft.get("living_area_m2")) draft.set("living_area_m2", plan.totalLivingArea_m2, "floor_plan");
        return ok(plan, `${plan.roomCount} rooms, ${plan.totalLivingArea_m2} m²${plan.hasBalcony ? ", balcony" : ""}`);
      },
    },
    {
      def: def("compare_sources", "Compare the notes against the floor plan and photos. Returns conflicts the broker must settle.", Empty),
      async run() {
        const conflicts = compareSources(draft);
        return ok(conflicts, conflicts.length ? conflicts.map((c) => c.message).join(" ") : "no conflicts");
      },
    },
    {
      def: def(
        "check_listing",
        "Check the draft: which required fields are still missing, which conflicts are open, and which steps are not done yet.",
        Empty,
      ),
      async run() {
        const missing = draft.missing();
        const conflicts = compareSources(draft);
        const pending = [
          ...(draft.photos ? [] : ["analyze_photos"]),
          ...(draft.plan ? [] : ["read_floor_plan"]),
          ...(draft.expose ? [] : ["submit_expose"]),
        ];
        const data = { missing, conflicts, pending };
        return ok(data, missing.length || conflicts.length ? `missing: ${missing.join(", ") || "none"}; conflicts: ${conflicts.length}` : "complete");
      },
    },
    {
      def: def(
        "ask_broker",
        "Ask the broker one question. The page shows a form with one input per field; the typed answers go straight into the draft " +
          "(source: broker). Use it for every conflict and every missing required field. Ask for all missing energy certificate fields in one call.",
        AskBroker,
      ),
      noTimeout: true,
      async run(input) {
        const p = parseInput(AskBroker, input);
        if (isResult(p)) return p;
        const unknown = p.fields.filter((f) => !isFieldId(f));
        if (unknown.length) return fail(`Unknown field ids: ${unknown.join(", ")}. Known: ${FIELD_IDS.join(", ")}`);
        const fields = p.fields as FieldId[];
        let context = p.context;
        for (let attempt = 1; attempt <= ASK_ATTEMPTS; attempt++) {
          const question: BrokerQuestion = { id: `q${++questionNo}`, question: p.question, fields, ...(context && { context }) };
          ctx.emit?.({ type: "question", question });
          const answer = await ctx.askBroker(question);
          const errors: string[] = [];
          const values = new Map<FieldId, unknown>();
          for (const f of fields) {
            const v = answer[f];
            if (v === undefined || v === null || v === "") {
              errors.push(`${f}: required`);
              continue;
            }
            try {
              values.set(f, parseField(f, v));
            } catch (e) {
              errors.push(e instanceof Error ? e.message : String(e));
            }
          }
          if (!errors.length) {
            for (const [f, v] of values) draft.set(f, v, "broker");
            ctx.emit?.({ type: "answer", questionId: question.id, answer: Object.fromEntries(values) });
            const stored = Object.fromEntries(values);
            return ok(stored, fields.map((f) => `${FIELD_LABELS[f].de}: ${String(values.get(f))}`).join(", "));
          }
          context = `Bitte korrigieren: ${errors.join("; ")}`;
        }
        return fail(`The broker did not give valid answers after ${ASK_ATTEMPTS} attempts.`);
      },
    },
    {
      def: def(
        "submit_expose",
        "Submit the exposé in German (de) and English (en): title, description, location text, features list. " +
          "Every number must come from the draft (notes, floor plan, broker answers); code rejects any other number.",
        Expose,
      ),
      async run(input) {
        const p = parseInput(Expose, input);
        if (isResult(p)) return p;
        const texts = (["de", "en"] as const).flatMap((l) => [p[l].title, p[l].description, p[l].location, ...p[l].features]);
        const invented = checkNumbers(texts, draft.knownNumbers());
        if (invented.length) {
          exposeFailures++;
          const list = invented.map((n) => `"${n.raw}" in "…${n.context}…"`).join("\n");
          if (exposeFailures > EXPOSE_REPAIRS) throw new RunAbort(`Number guard failed twice: ${invented.map((n) => n.raw).join(", ")}`);
          return fail(
            `Rejected: these numbers are not in the record:\n${list}\nUse only values from the draft, or rephrase without the number. Submit again.`,
            { invented },
          );
        }
        draft.expose = p;
        return ok({ accepted: true }, `accepted: "${p.de.title}"`);
      },
    },
    {
      def: def(
        "export_openimmo",
        "Export the listing as OpenImmo 1.2.7 XML and validate it. Refuses while required fields are missing, conflicts are open, " +
          "or photos/exposé are missing.",
        Empty,
      ),
      async run() {
        const missing = draft.missing();
        const conflicts = compareSources(draft);
        const problems = [
          ...(missing.length ? [`missing required fields: ${missing.join(", ")}`] : []),
          ...(conflicts.length ? [`open conflicts: ${conflicts.map((c) => c.message).join(" ")}`] : []),
          ...(draft.photos ? [] : ["photos not analysed"]),
          ...(draft.expose ? [] : ["no accepted exposé"]),
        ];
        if (problems.length) return fail(`Export refused: ${problems.join("; ")}. Ask the broker or finish the missing steps first.`, { problems });

        const keep = new Set(draft.photos!.photos.filter((p) => p.quality === "ok").map((p) => p.id));
        mkdirSync(join(ctx.outDir, "photos"), { recursive: true });
        const photoFiles: Record<string, string> = {};
        for (const p of ctx.photos) {
          if (!keep.has(p.id)) continue;
          const ext = p.mediaType === "image/png" ? "png" : p.mediaType === "image/webp" ? "webp" : "jpg";
          writeFileSync(join(ctx.outDir, "photos", `${p.id}.${ext}`), p.data);
          photoFiles[p.id] = `photos/${p.id}.${ext}`;
        }
        for (const p of draft.photos!.photos) photoFiles[p.id] ??= `photos/${p.id}.jpg`;

        const xml = buildOpenImmo(draft, { anbieterId: "LINDENHOF", objektId: `LH-${new Date().toISOString().slice(0, 10)}`, photoFiles });
        const file = join(ctx.outDir, "openimmo.xml");
        writeFileSync(file, xml);
        writeFileSync(join(ctx.outDir, "expose-en.json"), JSON.stringify(draft.expose!.en, null, 2));
        writeFileSync(join(ctx.outDir, "expose-de.json"), JSON.stringify(draft.expose!.de, null, 2));
        const v = await validateOpenImmo(xml);
        const data = { file, ...v };
        if (!v.valid) return fail(`Exported, but validation (${v.mode}) failed:\n${v.errors.join("\n")}`, data);
        return ok(data, `openimmo.xml valid (${v.mode === "xsd" ? "XSD 1.2.7" : "fallback check"})`);
      },
    },
  ];
  return tools;
}
