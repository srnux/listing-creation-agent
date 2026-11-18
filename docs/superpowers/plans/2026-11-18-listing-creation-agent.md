# Listing Creation Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent on Amazon Bedrock that turns photos, a floor plan and typed broker notes into a bilingual exposé and a validated OpenImmo XML file, shown live on a three-pane web page with a replay fallback.

**Architecture:** pnpm workspace like the reference project: `packages/core` (domain, photo checks, vision calls, guards, tools, loop; no HTTP or provider imports), `packages/server` (Bedrock adapter, HTTP + SSE API, run registry, replay, CLI), `apps/web` (React + Vite). The orchestrator (Opus 5.5) runs a plain tool-use loop; tools hold the rules in code; vision work happens in separate structured calls (Sonnet 5.5) inside tools.

**Tech Stack:** TypeScript, Node ≥ 20, pnpm 10, `@anthropic-ai/bedrock-sdk`, zod 4, sharp, xmlbuilder2, xmllint-wasm, React 19, Vite 8, Vitest 5.

**Spec:** `docs/superpowers/specs/2026-11-18-listing-creation-agent-design.md`

**Reference project (read-only, copy from it):** `C:\Users\LukaEngels\private\proptech-inquiry-agent` (below: `REF/`).

## Global Constraints

- Node ≥ 20, pnpm `10.28.0` (`packageManager` field), ESM (`"type": "module"`), `tsconfig.base.json` copied from `REF/tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, NodeNext).
- Dependency versions as in REF: `typescript ^7.0.2`, `vitest ^5.0.2`, `tsx ^4.23.15`, `zod ^4.6.5`, `@anthropic-ai/sdk ^0.129.0`, `@anthropic-ai/bedrock-sdk ^0.34.0`, `react`/`react-dom ^19.3.0`, `vite ^8.3.1`, `@vitejs/plugin-react ^6.1.1`. New deps (`sharp`, `xmlbuilder2`, `xmllint-wasm`): current version at install time.
- Bedrock only: `AWS_REGION=eu-central-1`, auth by `AWS_BEARER_TOKEN_BEDROCK` or the AWS credential chain. Models: `ORCHESTRATOR_MODEL` default `eu.anthropic.claude-opus-5-5`, `VISION_MODEL` default `eu.anthropic.claude-sonnet-5-5`.
- `packages/core` imports no HTTP, no `@anthropic-ai/*`, no React. The model is the `ModelClient` interface.
- All data synthetic or permissively licensed stock; fictional agency "Lindenhof Immobilien"; no real addresses (use a fictional street in a real district, e.g. "Musterstraße 12, Hamburg-Eimsbüttel").
- Rule in the system prompt and in code: **write only from the record; ask about everything else.**
- Photos sent to Bedrock: resized to long edge 1568 px, JPEG quality 80.
- OpenImmo 1.2.7. XSD lives in git-ignored `schemas/`, never committed.
- `.env` git-ignored; `.env.example` committed.

## Review Focus

1. **Number guard false positives** on legitimate text ("2. OG", "Baujahr 2023", "1.450 €", "3-Zimmer-Wohnung", "1 Balkon") → must pass when the value is in the record; numbers 0 and 1 always pass. Test in Task 3.
2. **Broker leaves a form field blank or types a wrong-type value** ("ca. 120" in a number field) → the answer is rejected with a per-field message and the form stays open; nothing half-valid enters the draft. Test in Task 8 (`ask_broker`) and Task 11 (form).
3. **The agent ends its turn without exporting** → the run finishes with outcome `incomplete` and a visible reason; the page never spins forever. Test in Task 8.
4. **Bedrock throttles or times out mid-run** → the run ends with outcome `failed` and the page shows "Bedrock error — switch to replay"; no hang. Test in Task 8 (model that throws) and Task 10 (SSE `error` event).
5. **A second run starts while a question is pending** (presenter clicks Run again) → the old run is aborted and its pending question rejected; the new run streams normally. Test in Task 10.

---

## File Structure

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, .gitignore, .env.example
packages/core/
  src/model.ts                 ModelClient, Block (+ image/document), structuredCall()
  src/domain/fields.ts         field schemas, FieldId, REQUIRED_FIELDS, enums
  src/domain/draft.ts          ListingDraft (facts with sources, photos, plan, exposé)
  src/domain/compare.ts        compareSources()
  src/guards/numbers.ts        number extraction + checkNumbers()
  src/photos/quality.ts        measurePhoto(), flagPhotos() (sharp)
  src/photos/analyze.ts        analyzePhotos() (vision call)
  src/floorplan/read.ts        readFloorPlan() (vision call)
  src/openimmo/build.ts        buildOpenImmo()
  src/openimmo/validate.ts     validateOpenImmo()
  src/agent/tools.ts           createTools()
  src/agent/prompt.ts          systemPrompt(tone)
  src/agent/loop.ts            runListing()
  src/testing.ts               ScriptedModel, fixtures
  src/index.ts
packages/server/
  src/bedrock.ts               BedrockModel (adapter from REF)
  src/check-models.ts          one-shot model access check
  src/runs.ts                  RunRegistry (runs, SSE fan-out, pending questions, recording)
  src/replay.ts                replayRun()
  src/api.ts, src/main.ts      HTTP routes
  src/cli.ts                   run the sample from the terminal
apps/web/src/                  App.tsx, Inputs.tsx, Steps.tsx, Result.tsx, QuestionForm.tsx, api.ts, styles.css, fonts/
data/sample/                   photos/, floorplan.svg, floorplan.png, notes.txt, agency-tone.md, CREDITS.md
scripts/make-sample.ts, scripts/fetch-xsd.ts
schemas/ (git-ignored)   runs/ (git-ignored except runs/known-good.json)   out/ (git-ignored)
```

---

### Task 1: Workspace, model interface and Bedrock adapter

**Files:**
- Create: root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`
- Create: `packages/core/{package.json,tsconfig.json}`, `packages/core/src/model.ts`, `packages/core/src/testing.ts`, `packages/core/src/index.ts`
- Create: `packages/server/{package.json,tsconfig.json}`, `packages/server/src/bedrock.ts`, `packages/server/src/check-models.ts`
- Test: `packages/core/test/model.test.ts`, `packages/server/test/bedrock.test.ts`

**Interfaces:**
- Produces (`@listing/core`):
  - `Block` = REF `model.ts` Block plus `{ type: "image"; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: string /* base64 */ }` and `{ type: "document"; mediaType: "application/pdf"; data: string }`.
  - `Message`, `ToolDef`, `Usage`, `emptyUsage`, `ModelResponse`, `ModelClient` as in REF.
  - `ModelRequest` as in REF plus `toolChoice?: { name: string }`.
  - `structuredCall<S extends z.ZodType>(model: ModelClient, opts: { system: string; content: Block[]; toolName: string; description: string; schema: S; maxTokens?: number; signal?: AbortSignal }): Promise<z.infer<S>>` — sends one tool built from `z.toJSONSchema(schema)` with `toolChoice: { name: toolName }`, parses the `tool_use` input with `schema.parse`; throws `StructuredCallError` (message includes zod issues) if no tool_use or invalid.
  - `ScriptedModel` (from REF `testing.ts`/`model.ts`: `say`, `call`, scripted steps) exported from `@listing/core/testing`.
- Produces (`@listing/server`): `class BedrockModel implements ModelClient { constructor(opts?: { model?: string; effort?: Effort; client?: MessagesClient }) }`.

- [ ] **Step 1: Scaffold.** `git init`; copy `tsconfig.base.json`, `pnpm-workspace.yaml` (packages `apps/*`, `packages/*`; `allowBuilds: { esbuild: true, sharp: true }`), and the root script layout from REF. Root scripts: `test` (vitest run), `typecheck`, `dev` (server + web in parallel), `sample` (`tsx packages/server/src/cli.ts`), `check-models`, `make-sample`, `fetch-xsd`. `.gitignore`: `node_modules`, `dist`, `.env`, `schemas/`, `out/`, `runs/*` with `!runs/known-good.json`. `.env.example` with `AWS_REGION`, `AWS_BEARER_TOKEN_BEDROCK`, `ORCHESTRATOR_MODEL`, `VISION_MODEL`, `PORT=3000`. Packages named `@listing/core`, `@listing/server`, `@listing/web`, run from source like REF (exports pointing at `src/*.ts`). `pnpm install`.

- [ ] **Step 2: Write failing tests.**

```ts
// packages/core/test/model.test.ts
test("structuredCall forces the tool and returns parsed input", async () => {
  const model = new ScriptedModel([(req) => {
    expect(req.toolChoice).toEqual({ name: "report" });
    expect(req.tools[0]!.name).toBe("report");
    return [call("report", { n: 3 })];
  }]);
  expect(await structuredCall(model, { system: "s", content: [say("x")], toolName: "report", description: "d", schema: z.object({ n: z.number() }) })).toEqual({ n: 3 });
});
test("structuredCall throws StructuredCallError on invalid input", async () => {
  const model = new ScriptedModel([[call("report", { n: "three" })]]);
  await expect(structuredCall(model, { system: "s", content: [say("x")], toolName: "report", description: "d", schema: z.object({ n: z.number() }) })).rejects.toThrow(StructuredCallError);
});

// packages/server/test/bedrock.test.ts — fake MessagesClient capturing the request
test("image and document blocks map to Messages API params", ...);   // {type:"image", source:{type:"base64", media_type, data}}
test("toolChoice sets tool_choice and omits output_config effort", ...); // forced tool_choice is incompatible with thinking
test("defaults to eu.anthropic.claude-opus-5-5 when ORCHESTRATOR_MODEL is unset", ...);
```

- [ ] **Step 3: Run** `pnpm test` → FAIL (modules missing).

- [ ] **Step 4: Implement.** Copy `REF/packages/core/src/agent/model.ts` and the `ScriptedModel` from REF into `model.ts`/`testing.ts`; add the two blocks, `toolChoice`, `structuredCall`, `StructuredCallError`. Copy `REF/packages/server/src/agent/anthropic.ts` into `bedrock.ts`, keep only the Bedrock path (`AnthropicBedrock`, refusal-fallback middleware with `betas: []`), model from `opts.model ?? process.env.ORCHESTRATOR_MODEL ?? "eu.anthropic.claude-opus-5-5"`, map the new blocks, set `tool_choice: { type: "tool", name }` and omit `output_config` when `toolChoice` is present. Load `.env` the way REF's `server/src/env.ts` does.

- [ ] **Step 5: Run** `pnpm test` → PASS; `pnpm typecheck` → no errors.

- [ ] **Step 6: Model access check.** `check-models.ts` sends "Reply with OK" to `ORCHESTRATOR_MODEL` and `VISION_MODEL` and one 64×64 test JPEG to `VISION_MODEL`, printing model id, latency and reply. Run `pnpm check-models`. Expected: three OK lines. If a model fails with AccessDenied/ValidationException, stop and report to the user (spec risk: model not enabled).

- [ ] **Step 7: Commit** `feat: workspace, model interface and Bedrock adapter`.

---

### Task 2: Listing draft, required fields, source comparison

**Files:**
- Create: `packages/core/src/domain/fields.ts`, `draft.ts`, `compare.ts`
- Test: `packages/core/test/draft.test.ts`, `compare.test.ts`

**Interfaces:**
- Produces:
  - `FIELD_SCHEMAS` (zod per field) and `type FieldId = keyof typeof FIELD_SCHEMAS`. Fields: `rooms` (number, step 0.5), `floor` (int), `living_area_m2` (number), `price_cold_eur` (number), `service_charges_eur` (number), `kitchen_year` (int), `built_in_kitchen` (bool), `balcony` (bool), `balcony_orientation` (enum `north|east|south|west|south-west|south-east|north-west|north-east`), `city` (string), `district` (string), `street` (string), `location_facts` (string[]), `available_from` (string), `energy_certificate_type` (enum `bedarf|verbrauch`), `energy_value_kwh` (number, kWh/m²a), `energy_carrier` (enum `gas|oel|fernwaerme|strom|waermepumpe|holz|solar`), `energy_construction_year` (int), `energy_class` (enum `A+|A|B|C|D|E|F|G|H`), `energy_valid_until` (ISO date string).
  - `FIELD_LABELS: Record<FieldId, { de: string; en: string }>` (used by the question form).
  - `REQUIRED_FIELDS: FieldId[]` = `price_cold_eur, living_area_m2, rooms, floor, city, district` + the six `energy_*`.
  - `type Source = "notes" | "floor_plan" | "broker" | \`photo:${string}\``; `interface Fact { field: FieldId; value: unknown; source: Source }`.
  - `class ListingDraft { set(field: FieldId, value: unknown, source: Source): void /* validates with FIELD_SCHEMAS, throws FieldError */; get(field): Fact | undefined; facts(): Fact[]; missing(): FieldId[]; knownNumbers(): Set<number>; photos?: PhotoAnalysis; plan?: FloorPlan; expose?: Expose; notes: string }` — `knownNumbers()` collects every numeric fact value, every number inside string facts (incl. `location_facts`), the plan's room areas and total area, and every number in `notes`. `set` on an existing field with a different source keeps the newer value (broker wins) and keeps the old one in `history`.
  - `interface Conflict { field: FieldId; values: { source: Source; value: unknown }[]; message: string }`; `compareSources(draft: ListingDraft): Conflict[]` — rules: `rooms` notes vs `plan.roomCount`; `balcony` notes vs plan/photos having a balcony; `living_area_m2` notes vs `plan.totalLivingArea_m2` if differing by more than 3 %. A field already answered by `broker` produces no conflict.
  - Types `PhotoAnalysis`, `FloorPlan`, `Expose` are declared here (`draft.ts`) and filled by Tasks 5, 6, 8:
    - `FloorPlan = { rooms: { name: string; type: RoomType; area_m2: number }[]; roomCount: number; totalLivingArea_m2: number; hasBalcony: boolean }`
    - `RoomType = "living" | "bedroom" | "study" | "kitchen" | "bathroom" | "hallway" | "balcony" | "exterior" | "other"`
    - `PhotoAnalysis = { photos: { id: string; room: RoomType; features: string[]; quality: "ok" | "poor"; reasons: string[] }[]; order: string[]; coverId: string }`
    - `Expose = Record<"de" | "en", { title: string; description: string; location: string; features: string[] }>`

- [ ] **Step 1: Failing tests.**

```ts
test("set rejects wrong types and unknown enum values", () => {
  const d = new ListingDraft("notes");
  expect(() => d.set("rooms", "three", "notes")).toThrow(FieldError);
  expect(() => d.set("energy_class", "Z", "broker")).toThrow(FieldError);
});
test("missing lists the six energy fields when only notes facts exist", () => {
  const d = sampleDraftFromNotes(); // fixture in testing.ts: rooms 3, floor 2, price 1450, kitchen_year 2023, balcony true/south, city, district, location_facts, living_area 78
  expect(d.missing()).toEqual(["energy_certificate_type","energy_value_kwh","energy_carrier","energy_construction_year","energy_class","energy_valid_until"]);
});
test("broker answer overrides notes and the conflict disappears", () => {
  const d = sampleDraftFromNotes(); d.plan = planWith4Rooms;   // fixture
  expect(compareSources(d).map(c => c.field)).toEqual(["rooms"]);
  d.set("rooms", 4, "broker");
  expect(d.get("rooms")).toMatchObject({ value: 4, source: "broker" });
  expect(compareSources(d)).toEqual([]);
});
test("knownNumbers includes notes numbers, location fact numbers and plan areas", () => { ... expect(known.has(1450)).toBe(true); expect(known.has(5)).toBe(true); expect(known.has(24.5)).toBe(true); });
```

- [ ] **Step 2: Run** `pnpm test packages/core/test/draft.test.ts packages/core/test/compare.test.ts` → FAIL.
- [ ] **Step 3: Implement** `fields.ts`, `draft.ts`, `compare.ts` and the fixtures in `testing.ts`.
- [ ] **Step 4: Run** the same command → PASS.
- [ ] **Step 5: Commit** `feat: listing draft with sourced facts, required fields and conflicts`.

---

### Task 3: Number guard

**Files:**
- Create: `packages/core/src/guards/numbers.ts`
- Test: `packages/core/test/numbers.test.ts`

**Interfaces:**
- Consumes: `ListingDraft.knownNumbers()`.
- Produces: `checkNumbers(texts: string[], known: Set<number>): { raw: string; context: string }[]` — returns every number in the texts whose possible values (REF `values()`: "1.450" → 1450 or 1.45, "1,450" likewise, "78,5" → 78.5) are all absent from `known`. Numbers 0 and 1 always pass. Ordinals ("2.") count as the number. `context` is ±20 chars around the match.

- [ ] **Step 1: Failing tests** (Review Focus 1):

```ts
const known = new Set([3, 2, 1450, 2023, 78, 5]);
test.each(["3-Zimmer-Wohnung im 2. OG", "Kaltmiete 1.450 €", "€1,450 cold", "Baujahr der Küche: 2023", "1 Balkon", "78 m²", "5 Minuten zur U-Bahn"])("passes %s", (t) => expect(checkNumbers([t], known)).toEqual([]));
test("flags an invented area", () => expect(checkNumbers(["ca. 65 m² Wohnfläche"], known).map(f => f.raw)).toEqual(["65"]));
test("flags across DE and EN texts", () => expect(checkNumbers(["4 Zimmer", "built 1998"], known).map(f => f.raw)).toEqual(["4", "1998"]));
```

- [ ] **Step 2: Run** → FAIL. **Step 3:** Implement, porting `NUM` and `values()` from `REF/packages/core/src/agent/guards.ts`. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: number guard for exposé text`.

---

### Task 4: Sample data

**Files:**
- Create: `data/sample/photos/*.jpg` (13 originals), `data/sample/CREDITS.md`, `data/sample/floorplan.svg`, `data/sample/notes.txt`, `data/sample/agency-tone.md`, `scripts/make-sample.ts`
- Generated (committed): `data/sample/photos/14-dark.jpg`, `15-blurry.jpg`, `16-duplicate.jpg`, `data/sample/floorplan.png`

**Interfaces:**
- Produces: the sample files at these exact paths; `packages/core/src/testing.ts` exports `SAMPLE_DIR` (absolute path to `data/sample`).

- [ ] **Step 1: Pick 13 stock photos** from Unsplash or Pexels (license allows free use) that plausibly form one bright, modern Altbau-style flat: 2× living room, kitchen (visibly new built-in kitchen), 2× bedroom, study, bathroom with bathtub, hallway with parquet, balcony, view from balcony, building exterior, 2 detail shots (parquet, kitchen detail). Save as `01-living.jpg` … `13-exterior.jpg`, long edge ≤ 2400 px. Record photographer, source URL and license per file in `CREDITS.md`.
- [ ] **Step 2: Write `floorplan.svg`:** 4 rooms (Wohnzimmer 24.5 m², Schlafzimmer 16.0 m², Kinderzimmer 12.5 m², Arbeitszimmer 9.0 m²) + Küche 8.5 m², Bad 5.0 m², Flur 4.5 m², Balkon 5.0 m² (counted half: 2.5) → Wohnfläche 82.5 m²; labels and areas written in the rooms, a north arrow, balcony on the south side.
- [ ] **Step 3: Write `notes.txt`:**

```
3 Zimmer, 2. OG, Küche neu 2023, Balkon Süd, 1.450 € kalt, NK 220 €.
Musterstraße 12, Hamburg-Eimsbüttel. Ruhige Seitenstraße, 5 Min. zur U-Bahn Osterstraße, Park um die Ecke.
Parkett, Wanne im Bad. Frei ab 1.2.2027.
```
(No living area, no energy data: the plan supplies the area, the broker the energy data.)

- [ ] **Step 4: Write `agency-tone.md`** for the fictional "Lindenhof Immobilien": warm, factual, no superlatives ("traumhaft", "einzigartig" banned), short paragraphs, "Sie" form, English version in British English, plain and factual.
- [ ] **Step 5: `scripts/make-sample.ts`** (sharp): `14-dark.jpg` = `02-living` with brightness ×0.25; `15-blurry.jpg` = `05-bedroom` with `blur(12)`; `16-duplicate.jpg` = `01-living` cropped 5 % and re-encoded; `floorplan.png` = rendered `floorplan.svg` at 1600 px wide. Run `pnpm make-sample`; Expected: four files written, sizes printed.
- [ ] **Step 6: Commit** `chore: synthetic sample flat (stock photos, floor plan, notes, tone)`.

---

### Task 5: Photo quality checks in code

**Files:**
- Create: `packages/core/src/photos/quality.ts`
- Test: `packages/core/test/quality.test.ts`

**Interfaces:**
- Produces:
  - `interface Photo { id: string /* file name without extension */; mediaType: "image/jpeg" | "image/png" | "image/webp"; data: Buffer }`
  - `measurePhoto(photo: Photo): Promise<{ id: string; brightness: number /* mean luma 0–255 */; sharpness: number /* variance of Laplacian on 512px grayscale */; hash: string /* 64-bit dHash hex */ }>`
  - `flagPhotos(measures: Measure[], t = QUALITY_THRESHOLDS): Record<string, string[]>` — flags `"dark"` (brightness < t.dark), `"blurry"` (sharpness < t.blur), `"duplicate_of:<id>"` (Hamming distance ≤ t.dupDistance to an earlier photo).
  - `QUALITY_THRESHOLDS = { dark: 60, blur: <tuned>, dupDistance: 6 }`
  - `prepareForModel(photo: Photo): Promise<Block>` — resize long edge 1568, JPEG q80, return image block.

- [ ] **Step 1: Failing test** on the real sample:

```ts
test("flags exactly the planted photos in the sample", async () => {
  const flags = flagPhotos(await Promise.all(loadSamplePhotos().map(measurePhoto)));
  expect(Object.entries(flags).filter(([, f]) => f.length).map(([id, f]) => [id, f])).toEqual([
    ["14-dark", ["dark"]], ["15-blurry", ["blurry"]], ["16-duplicate", ["duplicate_of:01-living"]],
  ]);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**; print all measures once, set `blur` midway between `15-blurry` and the least-sharp original. **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: photo quality checks (dark, blurry, duplicate)`.

---

### Task 6: Vision calls: photo analysis and floor plan

**Files:**
- Create: `packages/core/src/photos/analyze.ts`, `packages/core/src/floorplan/read.ts`
- Test: `packages/core/test/vision.test.ts` (scripted), `packages/server/test/vision-live.test.ts` (live, skipped unless `LIVE=1`)

**Interfaces:**
- Consumes: `structuredCall`, `Photo`, `measurePhoto`, `flagPhotos`, `prepareForModel`, `PhotoAnalysis`, `FloorPlan`, `RoomType`.
- Produces:
  - `analyzePhotos(model: ModelClient, photos: Photo[]): Promise<PhotoAnalysis>` — one `structuredCall` with all prepared images, each preceded by a text block `Photo <id> — code flags: <flags or none>`. Then code enforces: a photo with code flags is `quality: "poor"` with those reasons added; `order` contains every id exactly once, poor ones last; if `coverId` is poor or missing, cover = first `ok` photo in `order` whose room is `living` or `exterior`, else first `ok`.
  - `readFloorPlan(model: ModelClient, plan: { mediaType: "image/png" | "image/jpeg" | "application/pdf"; data: Buffer }): Promise<FloorPlan>` — one `structuredCall`; `roomCount` = count of `living|bedroom|study` rooms computed in code, not taken from the model.

- [ ] **Step 1: Failing scripted tests:**

```ts
test("code flags override the model's quality verdict and the cover", async () => {
  const model = new ScriptedModel([[call("report_photos", { photos: [{ id: "a", room: "living", features: [], quality: "ok", reasons: [] }, { id: "b", room: "living", features: [], quality: "ok", reasons: [] }], order: ["b", "a"], coverId: "b" })]]);
  const r = await analyzePhotos(model, [photoA, darkPhotoB]);   // fixtures: b is a black 64×64 jpeg
  expect(r.photos.find(p => p.id === "b")).toMatchObject({ quality: "poor", reasons: ["dark"] });
  expect(r.coverId).toBe("a"); expect(r.order).toEqual(["a", "b"]);
});
test("roomCount is computed from room types", async () => { /* model returns 4 living/bedroom/study + kitchen, bath → roomCount 4 */ });
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with prompts: photos → "Identify the room, list visible features (parquet, built-in kitchen, bathtub, balcony, …) in English lowercase, judge quality, suggest an order that walks a buyer through the flat starting with the best living-room or exterior shot, and pick the cover." Floor plan → "Extract every room with its area as written on the plan; do not estimate areas that are not written." **Step 4: Run** → PASS.
- [ ] **Step 5: Live check:** `LIVE=1 pnpm vitest run packages/server/test/vision-live.test.ts` on the sample with `VISION_MODEL`. Expected: 16 photos analysed; `14-dark`, `15-blurry`, `16-duplicate` poor; floor plan `roomCount` 4, `totalLivingArea_m2` 82.5 (±0.5); both calls print latency (target < 40 s for photos).
- [ ] **Step 6: Commit** `feat: photo analysis and floor plan reading on Bedrock`.

---

### Task 7: OpenImmo export and validation

**Files:**
- Create: `packages/core/src/openimmo/build.ts`, `validate.ts`, `scripts/fetch-xsd.ts`
- Test: `packages/core/test/openimmo.test.ts`

**Interfaces:**
- Consumes: `ListingDraft`, `Expose`, `PhotoAnalysis`.
- Produces:
  - `buildOpenImmo(draft: ListingDraft, opts: { anbieterId: string; objektId: string; photoFiles: Record<string, string> }): string` — OpenImmo 1.2.7 (xmlbuilder2): `objektkategorie` (nutzungsart WOHNEN, vermarktungsart MIETE_PACHT, objektart wohnung ETAGE), `geo` (plz/ort/strasse/hausnummer/regionaler_zusatz=district/etage), `preise` (kaltmiete, nebenkosten), `flaechen` (wohnflaeche, anzahl_zimmer, anzahl_balkone), `ausstattung` (boden PARKETT, kueche EBK, bad WANNE from photo/notes features), `zustand_angaben/energiepass` (epart, gueltig_bis, energieverbrauchkennwert or endenergiebedarf, primaerenergietraeger, baujahr, wertklasse), `freitexte` from `expose.de` (objekttitel, objektbeschreibung, lage, ausstatt_beschr = features joined), `anhaenge` in `order`, poor photos excluded, cover with `gruppe="TITELBILD"`, others `BILD`, `verwaltung_techn` (objektnr_extern, aktion NEU, openimmo_obid, stand_vom today). English exposé is written to a separate `expose-en.json` next to the XML (decision for the open point in the spec).
  - `validateOpenImmo(xml: string): Promise<{ valid: boolean; mode: "xsd" | "fallback"; errors: string[] }>` — `xmllint-wasm` against `schemas/openimmo_127b.xsd` when present; else fallback: parse and check presence of the elements listed above, `mode: "fallback"`.
  - `scripts/fetch-xsd.ts`: downloads the OpenImmo 1.2.7 XSD into `schemas/`. If the download page requires a login, print the manual instruction ("download OpenImmo 1.2.7 from openimmo.de and place the .xsd in schemas/") and exit 0.

- [ ] **Step 1: Failing tests:**

```ts
test("complete sample draft builds and validates", async () => {
  const xml = buildOpenImmo(completeDraft(), opts);   // fixture with all required fields, plan, photos, exposé
  const r = await validateOpenImmo(xml);
  expect(r.errors).toEqual([]); expect(r.valid).toBe(true);
});
test("cover is TITELBILD, poor photos are excluded, order is kept", () => { ... });
test("kaltmiete and wohnflaeche carry the draft values", () => { expect(xml).toContain("<kaltmiete>1450</kaltmiete>"); expect(xml).toContain("<wohnflaeche>82.5</wohnflaeche>"); });
test("validation reports errors on a broken document", async () => { expect((await validateOpenImmo("<openimmo/>")).valid).toBe(false); });
```

- [ ] **Step 2: Run `pnpm fetch-xsd`**, then `pnpm test packages/core/test/openimmo.test.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS (note in the commit message whether `mode` was `xsd` or `fallback`).
- [ ] **Step 5: Commit** `feat: OpenImmo 1.2.7 export with schema validation`.

---

### Task 8: Tools, system prompt and agent loop

**Files:**
- Create: `packages/core/src/agent/tools.ts`, `prompt.ts`, `loop.ts`
- Test: `packages/core/test/tools.test.ts`, `packages/core/test/loop.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces:
  - `interface BrokerQuestion { id: string; question: string; fields: FieldId[]; context?: string }`; `type BrokerAnswer = Partial<Record<FieldId, unknown>>`.
  - `interface RunContext { draft: ListingDraft; photos: Photo[]; plan: { mediaType: ...; data: Buffer }; visionModel: ModelClient; askBroker(q: BrokerQuestion): Promise<BrokerAnswer>; outDir: string }`
  - `interface Tool { def: ToolDef; run(input: unknown, signal: AbortSignal): Promise<{ content: string; isError?: boolean; data?: unknown }>; noTimeout?: boolean }`
  - `createTools(ctx: RunContext): Tool[]` with exactly these names and behaviour:
    - `record_facts({ facts: { field, value }[] })` → `draft.set(..., "notes")` each; invalid entries returned as errors, valid ones kept.
    - `analyze_photos({})` → `analyzePhotos(ctx.visionModel, ctx.photos)`, stores `draft.photos`, sets `built_in_kitchen`/`balcony` facts from features with source `photo:<id>` only if absent; returns the summary JSON.
    - `read_floor_plan({})` → stores `draft.plan`, sets `living_area_m2` (source `floor_plan`) if absent.
    - `compare_sources({})` → `compareSources(draft)`.
    - `check_listing({})` → `{ missing: draft.missing(), conflicts: compareSources(draft) }`.
    - `ask_broker({ question, fields, context? })` (`noTimeout: true`) → `ctx.askBroker`; every answered field validated with `FIELD_SCHEMAS` and stored with source `broker`; if any field is blank or invalid, nothing is stored and the tool **re-asks** with the per-field errors in `context` (max 3 attempts, then tool error). Returns the stored facts.
    - `submit_expose({ de, en })` → zod-validated `Expose`; `checkNumbers` over all strings of both languages against `draft.knownNumbers()`; on violations returns `isError` naming each number with its context and the instruction to use only record values or rephrase; the 2nd failure throws `RunAbort("number guard failed twice: …")`. On success stores `draft.expose`.
    - `export_openimmo({})` → refuses (`isError`) while `draft.missing()` is non-empty, conflicts exist, or `draft.expose`/`draft.photos` are missing, naming what is missing; otherwise builds, validates, writes `<outDir>/openimmo.xml` and `expose-en.json`, returns `{ file, valid, mode, errors }` (schema errors → `isError`).
  - `systemPrompt(tone: string): string` — role (listing assistant for Lindenhof Immobilien), the rule "write only from the record; ask the broker about every conflict and every missing required field, never guess", the suggested working order (record notes → photos → plan → compare/check → ask → write → submit → export), ask all missing energy fields in **one** `ask_broker`, location text only from `district` and `location_facts`, the tone guide appended.
  - `type RunEvent = { type: "model"; turn: number; text: string } | { type: "tool_start"; callId: string; tool: string; input: unknown } | { type: "tool_end"; callId: string; tool: string; summary: string; result: unknown; isError: boolean; durationMs: number } | { type: "question"; question: BrokerQuestion } | { type: "answer"; questionId: string; answer: BrokerAnswer } | { type: "done"; outcome: Outcome; draft: DraftSnapshot; usage: Usage }`
  - `type Outcome = { status: "exported"; file: string; valid: boolean; mode: "xsd" | "fallback" } | { status: "incomplete"; reason: string } | { status: "failed"; reason: string }`
  - `runListing(deps: { model: ModelClient; ctx: RunContext; tone: string; limits?: Partial<Limits>; onEvent?(e: RunEvent): void; signal?: AbortSignal }): Promise<{ outcome: Outcome; usage: Usage }>` — REF loop shape without guards-on-final-answer (the guards live in the tools). `Limits = { maxTurns: 20, tokenBudget: 400_000, modelTimeoutMs: 120_000, toolTimeoutMs: 120_000, maxTokens: 16_000 }`. First user message: the notes text plus "Photos: 16 files (ids …). Floor plan: provided." End: model `end_turn` → `exported` if `export_openimmo` succeeded in this run, else `incomplete` with the model's last text as reason. `RunAbort`, model errors, timeouts, limits, `signal` abort → `failed` with reason. Never throws.
  - `DraftSnapshot = { facts: Fact[]; photos?: PhotoAnalysis; plan?: FloorPlan; expose?: Expose }` (`draft.snapshot()`).

- [ ] **Step 1: Failing tool tests:**

```ts
test("export refuses while energy fields are missing", async () => { /* draft from notes + plan + photos + exposé */ expect(res.isError).toBe(true); expect(res.content).toContain("energy_class"); });
test("ask_broker stores typed answers with source broker", ...);
test("ask_broker re-asks when a field is blank or invalid and stores nothing", async () => {   // Review Focus 2
  const answers = [{ energy_value_kwh: "ca. 120", energy_class: "C" }, validEnergyAnswer];
  ... expect(askCalls).toBe(2); expect(askCalls2Context).toContain("energy_value_kwh"); expect(draft.get("energy_class")!.source).toBe("broker");
});
test("submit_expose rejects an invented number, second failure aborts", ...);
```

- [ ] **Step 2: Failing loop tests** (ScriptedModel scripting the happy path: record_facts → analyze_photos → read_floor_plan → check_listing → ask_broker(rooms) → ask_broker(energy) → submit_expose → export_openimmo → end_turn; vision calls use a second ScriptedModel):

```ts
test("happy path exports a valid file and emits events in order", async () => { expect(outcome.status).toBe("exported"); expect(events.map(e => e.type)).toContain("question"); });
test("ending without export is incomplete, not a hang", async () => { /* model says 'done' after check_listing */ expect(outcome).toMatchObject({ status: "incomplete" }); });   // Review Focus 3
test("a model error ends the run as failed", async () => { /* model.complete throws ThrottlingException */ expect(outcome).toMatchObject({ status: "failed" }); expect(outcome.reason).toContain("Throttling"); }); // Review Focus 4
test("ask_broker is not cut by the tool timeout", async () => { /* toolTimeoutMs: 50, broker answers after 100 ms */ });
```

- [ ] **Step 3: Run** `pnpm test packages/core` → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS; `pnpm typecheck` clean.
- [ ] **Step 6: Commit** `feat: agent tools and loop with broker questions and guarded exposé`.

---

### Task 9: CLI end-to-end on Bedrock (milestone: the agent works)

**Files:**
- Create: `packages/server/src/cli.ts`, `packages/server/src/sample.ts`

**Interfaces:**
- Produces: `loadSample(): Promise<{ notes: string; photos: Photo[]; plan: {...}; tone: string }>` (`sample.ts`, reused by the API).
- CLI prints each `RunEvent` as one line (`→ tool input`, `✓ tool summary (ms)`, `✗ tool error`), asks `ask_broker` questions on stdin field by field (shows enum choices), writes `out/<timestamp>/`.

- [ ] **Step 1: Implement** `sample.ts` and `cli.ts` with `BedrockModel` (orchestrator) and `BedrockModel({ model: VISION_MODEL })`.
- [ ] **Step 2: Run** `pnpm sample`. Answer rooms = 4, energy: verbrauch, 112, fernwaerme, 1962, D, 2032-05-31. Expected: the agent asks about the room conflict and the energy fields, at least the DE and EN exposé is accepted, `out/<ts>/openimmo.xml` exists with `valid: true`. Record wall-clock time (target < 3 min). If the agent misbehaves, adjust `prompt.ts` only, rerun, and note what changed.
- [ ] **Step 3: Commit** `feat: run the sample end to end from the CLI`.

---

### Task 10: HTTP API, run registry and SSE

**Files:**
- Create: `packages/server/src/runs.ts`, `api.ts`, `main.ts`
- Test: `packages/server/test/api.test.ts`

**Interfaces:**
- Consumes: `runListing`, `loadSample`, `BedrockModel`, `RunEvent`.
- Produces:
  - `class RunRegistry { start(input: RunInput, deps): Run; get(id): Run | undefined; answer(runId: string, questionId: string, answer: BrokerAnswer): boolean }` — only one active run: `start` aborts the previous run and rejects its pending question (Review Focus 5). Each `Run` keeps all events with `t` (ms since start) and appends them to `runs/<iso-timestamp>.json` on `done` (`{ startedAt, events: (RunEvent & { t: number })[] }`).
  - Routes (node:http, same style as REF `api/app.ts`):
    - `GET /sample` → `{ notes, photos: { id, url }[], planUrl }`; `GET /sample/files/<name>` serves sample files.
    - `POST /runs` JSON `{ notes: string; photos: { id; mediaType; data: base64 }[]; plan: { mediaType; data: base64 } } | { sample: true }` (body limit 80 MB) → `{ runId }`.
    - `GET /runs/:id/events` → SSE; replays events so far, then live; `event: <type>`; on unexpected error `event: error` `{ message }`.
    - `POST /runs/:id/answers` `{ questionId, answer }` → 204, 404 unknown run, 409 no such pending question.
    - `GET /runs/:id/openimmo.xml`, `GET /runs/:id/photos/:photoId` (for the result grid).
    - `GET /replays` → list of `runs/*.json`; replay route in Task 12.

- [ ] **Step 1: Failing tests** (ScriptedModel injected; HTTP via `fetch` on an ephemeral port):

```ts
test("sample run streams tool events, pauses on a question, resumes on answer, ends with done", ...);
test("answering an unknown question returns 409", ...);
test("starting a second run aborts the first and its pending question", async () => { /* first run's events end with done{status:"failed", reason contains "superseded"} */ });  // Review Focus 5
test("a model error reaches the client as done failed", ...);                        // Review Focus 4
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: HTTP API with live run events and broker answers`.

---

### Task 11: Web page

**Files:**
- Create: `apps/web/{package.json,index.html,vite.config.ts,tsconfig.json}`, `apps/web/src/{main.tsx,App.tsx,Inputs.tsx,Steps.tsx,Result.tsx,QuestionForm.tsx,api.ts,styles.css}`, `apps/web/src/fonts/*` (copied from REF)
- Test: `apps/web/test/question-form.test.ts` (pure logic)

**Interfaces:**
- Consumes: API from Task 10; `FIELD_SCHEMAS`, `FIELD_LABELS` from `@listing/core` (browser-safe module; keep `fields.ts` free of Node imports).
- Produces: the page as in the spec's sketch. `api.ts`: `startRun(input): Promise<string>`, `subscribe(runId, onEvent): () => void` (EventSource), `answer(runId, questionId, answer)`. `QuestionForm` exports `parseAnswer(fields: FieldId[], raw: Record<string, string>): { answer?: BrokerAnswer; errors: Partial<Record<FieldId, string>> }` (numbers accept "1.450" and "1450,5"; enums from selects; blank → error).

- [ ] **Step 1: Failing test** for `parseAnswer`: blank field → error; "ca. 120" in `energy_value_kwh` → error; valid set → answer with numbers converted. (Review Focus 2.)
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `parseAnswer`. **Step 4: Run** → PASS.
- [ ] **Step 5: Build the page.** Copy REF `styles.css` tokens and fonts (Monochrome look, status hues). Left: photo thumbnails, plan preview, notes textarea, buttons "Load sample", "Run", mode switch Live/Replay. Middle: one row per tool call (spinner → ✓/✗ with summary), model text lines in grey, guard rejections in red, the question as a yellow card with `QuestionForm` (labels in German from `FIELD_LABELS`, selects for enums, the agent's question text and context on top). Right: photo grid in suggested order (cover badge, poor photos greyed with reason), exposé with DE | EN tabs, features list, facts table with source chips (notes / plan / photo / broker), "Download OpenImmo XML" with "valid against XSD 1.2.7" or "fallback check" badge.
- [ ] **Step 6: Run** `pnpm dev`, open `http://localhost:5173`, Load sample → Run, answer both questions. Expected: full run to the download button with no console errors.
- [ ] **Step 7: Commit** `feat: three-pane web page for live runs`.

---

### Task 12: Replay and the known-good run

**Files:**
- Create: `packages/server/src/replay.ts`; modify `api.ts`, `apps/web/src/App.tsx`
- Test: `packages/server/test/replay.test.ts`

**Interfaces:**
- Produces: `replayRun(file: string, emit: (e: RunEvent) => void, opts: { speed: number; waitForAnswer(q: BrokerQuestion): Promise<void>; signal?: AbortSignal }): Promise<void>` — emits recorded events with original gaps divided by `speed` (default 1.5); on a `question` event it waits for `waitForAnswer` (the presenter clicks submit; the form is prefilled with the recorded answer), then emits the recorded `answer` and continues. Route `POST /replays/:name` → `{ runId }`, events then via the normal `GET /runs/:id/events`; answers via the normal answers route. Downloads in replay serve the recorded run's XML (copy `out/<ts>/openimmo.xml` next to the recording as `runs/<name>.xml`).

- [ ] **Step 1: Failing test:** a recorded file with gaps 0/100/300 ms at speed 2 emits in order, total ≈ 150 ms (±50); it pauses at `question` until `waitForAnswer` resolves.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, add the Live/Replay switch to the page (replay lists `/replays`, default `known-good`). **Step 4: Run** → PASS.
- [ ] **Step 5: Record the known-good run:** run the sample live in the page; when it ends `exported` and valid, copy it to `runs/known-good.json` (+ `.xml`). Replay it in the page once end to end.
- [ ] **Step 6: Commit** `feat: replay recorded runs; add known-good sample run`.

---

### Task 13: Step details and demo polish (cut first if short of time)

**Files:**
- Modify: `apps/web/src/Steps.tsx`, `Result.tsx`, `styles.css`; create `README.md` (short: what it is, `pnpm install`, `.env`, `pnpm dev`, demo script)

- [ ] **Step 1:** Click a step row → expands input and result JSON (pretty-printed, collapsible); show tokens and total time in the header when `done` arrives.
- [ ] **Step 2:** README with the three-minute demo script: Load sample → Run → point at flagged photos → answer "4 rooms" → answer energy form → show a red number-guard rejection if one occurs → DE/EN tabs → download XML, show the valid badge → expand a step for the developers. Fallback: switch to Replay → `known-good`.
- [ ] **Step 3: Verify:** `pnpm typecheck && pnpm test` → all pass; one more full live run in the page.
- [ ] **Step 4: Commit** `feat: step details, README and demo script`.
