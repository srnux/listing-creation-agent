# Listing Creation Agent: design

Date: 2026-11-18. Status: draft for approval.

## Intent and why

A broker has just walked through a flat. They upload about 15 photos, a floor plan and a few typed notes
("3 rooms, 2nd floor, new kitchen 2023, balcony south, €1,450 cold"). An AI agent turns that into a
portal-ready listing: it sorts and checks the photos, reads the floor plan, finds conflicts and gaps and asks
the broker about them instead of guessing, writes the exposé in German and English, and exports OpenImmo XML.

This is the practical part of an AI workshop, **presented live tomorrow (2026-11-19)**. Afterwards it becomes a
portfolio project next to `C:\Users\LukaEngels\private\proptech-inquiry-agent` (the "reference project"). It
will not be used in production.

The audience is mixed: AI experts, software developers, two salespeople and an AI teacher. The demo has to land
on two levels:

- **Salespeople:** messy inputs become a finished bilingual exposé on one screen in about two minutes, and the
  agent visibly catches the "notes say 3 rooms, plan shows 4" conflict and asks.
- **Developers and AI experts:** they can open every step the agent took, see the checks in code that rejected
  something, and see the XML validated against the official schema.

## Goals

1. A real agent loop on Amazon Bedrock (the user chose this over a fixed pipeline): the model decides which tool
   to call next; the rules live in the tools.
2. Photo analysis: room type per photo, visible features (parquet, built-in kitchen, bathtub, balcony...),
   quality flags (dark, blurry, near-duplicate), a suggested order and a cover image.
3. Floor plan reading: rooms and areas, cross-checked against the notes; a conflict becomes a question.
4. Missing required data (energy certificate above all, which German law, GEG §87, requires in property ads) is
   asked for, never invented.
5. Exposé: title, description, location text, features list, in the agency's tone, German and English as
   separate versions.
6. OpenImmo XML export, validated against the official XSD.
7. A web page that shows all of this live, with an inspectable step trace.
8. A replay mode, so a failed or slow Bedrock call on stage does not end the demo.

## Non-goals (tonight and tomorrow)

- Voice notes (Bedrock Claude cannot transcribe audio; Amazon Transcribe is a later slice). Notes are typed.
- Uploading to ImmoScout24 / immowelt. The XML file is the end product.
- Full eval suite, DECISIONS.md, polished README. Those come after the workshop for the portfolio version.
- MCP server. Tools are plain TypeScript functions with zod schemas behind the loop; MCP can come later.
- Auth, persistence beyond local files, multiple users, deployment. It runs on the presenter's laptop.

## Anti-goals (failure even if it "works")

- The exposé states a number (price, area, rooms, year, floor, energy value) that came from nowhere.
- The export succeeds while legally required energy-certificate fields are missing.
- The live demo hangs with no way forward.
- Real-looking personal data or a real agency's branding. The agency is fictional; all data is synthetic or
  stock with a permissive license.

## Constraints

- TypeScript, Node ≥ 20, pnpm, as in the reference project.
- Amazon Bedrock via `@anthropic-ai/bedrock-sdk` (`AnthropicBedrock`, Messages API), EU inference profiles
  (`eu.anthropic.<model>`), `AWS_REGION=eu-central-1`, auth via `AWS_BEARER_TOKEN_BEDROCK` or the AWS credential
  chain. Reuse the adapter and `ModelClient` interface from the reference project
  (`packages/server/src/agent/anthropic.ts`, `packages/core/src/agent/model.ts`).
- Time: the rest of today plus about 3 hours tomorrow before presenting. Scope cuts favour demo reliability.
- Bedrock image limits: resize photos (long edge ~1568 px, JPEG) before sending.

## Approaches considered

| | Approach | Trade-off | Verdict |
|---|---|---|---|
| A | Fixed pipeline (photos → plan → compare → check → write → export), one structured Bedrock call per step, web page, replay | Most predictable live; not a "real" agent | Recommended by Claude, not chosen |
| **B** | **Agent loop with tools, like the reference project's inquiry agent** | Impresses the AI experts, shows real agent behaviour; less predictable, more to stabilise in the time | **Chosen by the user** |
| C | CLI only | Fastest and safest; nothing for the salespeople to see | Rejected |

The replay safety net from A is kept in B (Claude's call).

## Design

### Shape

```
apps/web          React + Vite page (reuse the reference project's setup and CSS look)
packages/core     domain (listing draft, required fields, OpenImmo mapping), tools, agent loop, guards
packages/server   HTTP API (SSE), Bedrock adapter (copied from reference), replay, CLI
data/sample/      stock photos + generated dark/blurry/duplicate variants, floor plan, notes, agency tone
```

Same rule as the reference: `core` has no provider or HTTP imports; the model is a `ModelClient` interface with a
scripted fake for offline tests. (Claude's call; the builder may collapse to fewer packages if faster.)

### The listing draft (the "record")

A single in-memory object per run. Every fact in it carries its **source**: `notes`, `floor_plan`, `photo:<id>`
or `broker`. Tools read and write it; the model never holds the only copy of a fact. The number guard and the
export read from it.

### Tools

| Tool | What it does | Rules enforced in code |
|---|---|---|
| `record_facts` | The agent records facts it read from the notes (rooms, floor, price cold, kitchen year, balcony orientation...) with source `notes` | Fields from a fixed schema only (zod); unknown fields rejected |
| `analyze_photos` | Code first computes per photo: mean brightness (dark), Laplacian variance (blurry), perceptual hash (near-duplicate), using `sharp`. Then one **separate** vision call (Sonnet 5.5) gets all resized photos plus those flags and returns, per photo: room, features, quality verdict; plus suggested order and cover. Result goes into the draft; the main agent sees the JSON summary, not the images | Output validated with zod; a flagged-poor photo cannot be the cover |
| `read_floor_plan` | Separate vision call on the plan image/PDF; returns rooms with type and area, total living area | zod-validated |
| `compare_sources` | Code compares notes vs plan vs photos (room count, balcony present, kitchen) and returns the conflicts as a list | Pure code, deterministic |
| `check_listing` | Code checks the draft against a fixed list of required fields (price, living area, rooms, floor, address/district, energy certificate: type, value kWh/m²a, energy carrier, construction year, efficiency class, valid until) and returns what is missing | The list is code, not prompt |
| `ask_broker` | Asks the broker one question, tied to **draft fields**: the agent passes the field ids it needs (e.g. `rooms`, or all six `energy_*` fields) plus a short question text. The page renders a small form with one typed input per field (choices where the schema has an enum, e.g. energy certificate type, carrier, class). The run pauses; the broker's typed values go straight into the draft with source `broker`, so the model never converts a free-text answer into facts. All missing energy fields are asked in **one** pause (Claude's call) | The only way to resolve a conflict or fill a required gap. Values validated by the same zod field schema. No time limit (exempt from the per-tool timeout) |
| `submit_expose` | The agent submits the exposé it wrote: `de` and `en`, each with title, description, location text, features list | **Number guard:** every number in the text must match a fact in the draft (with unit tolerance, e.g. "1.450 €" = 1450). Failure returns an error naming the offending numbers; the agent repairs. Two failures end the run with a clear message |
| `export_openimmo` | Builds OpenImmo XML from the draft + accepted exposé + photo order/cover, validates against the XSD, saves the file | **Refuses** while `check_listing` reports anything missing. Schema errors are returned to the agent |

The orchestrating model is Opus 5.5 (`eu.anthropic.claude-opus-5-5`). The system prompt states the rule from the
reference project, adapted: **write only from the record; ask about everything else.** It includes the agency's
tone guide (`data/sample/agency-tone.md`, fictional agency).

### Loop

Based on the reference project's loop (`packages/core/src/agent/loop.ts`): plain tool-use loop, limits on turns,
tokens and per-call timeouts (raise turn limit to ~20; `ask_broker` exempt from tool timeout). Every model call and
tool call emits an event.

### Web page

Three panes, reusing the reference project's look:

```
┌ Inputs ──────────────┬ Agent steps ─────────────┬ Result ─────────────────────┐
│ [drop photos]        │ ✓ record_facts  (3 facts)│ Photo grid in suggested     │
│ [drop floor plan]    │ ✓ analyze_photos 16 → 13 │  order, cover marked, poor  │
│ notes: 3 rooms, ...  │ ⚠ compare: 3 vs 4 rooms  │  photos greyed with reason  │
│ [Load sample] [Run]  │ ? ask_broker ──────────┐ │ Exposé  [DE | EN]           │
│ ( ) live  ( ) replay │   "Notes say 3 rooms,  │ │ Features list               │
│                      │    plan shows 4..."    │ │ [Download OpenImmo XML] ✓   │
│                      │   [answer box]         │ │   valid against XSD 1.2.7   │
│                      │ ✗ submit_expose: "65"  │ │                             │
│                      │   not in record → retry│ │                             │
└──────────────────────┴────────────────────────┴─┴─────────────────────────────┘
```

Each step row expands to show its input and output JSON (for the developers). Rejections by guards are shown in a
distinct colour; they are a feature of the demo, not an embarrassment.

API: `POST /runs` (multipart: photos, plan, notes) → SSE stream of events; `POST /runs/:id/answers` answers a
pending `ask_broker`. "Load sample" fills the inputs from `data/sample/`.

### Replay

Every run's event stream (with timestamps and the broker's answers) is saved to `runs/<timestamp>.json`. Replay
mode streams a saved run with its original timing (optionally sped up), and the questions appear as in the
live run (the presenter can click the recorded answer). A known-good run of the sample is recorded tomorrow
before the workshop and is the fallback on stage.

### Sample data

- ~13 free stock photos (Unsplash/Pexels license) chosen to look like one bright flat: living room, kitchen,
  bedroom, second bedroom/study, bathroom with tub, hallway, balcony, exterior. Licenses/credits noted in
  `data/sample/CREDITS.md`.
- Generated by a script: one darkened copy, one blurred copy, one near-duplicate (slight crop) → 16 photos.
- A floor plan drawn by us (SVG → PNG) with **4 rooms** + kitchen, bath, hall, balcony, areas written on it.
- Notes: `3 rooms, 2nd floor, new kitchen 2023, balcony south, €1,450 cold`, plus a district and two or three
  location facts (e.g. "quiet side street, 5 min walk to U-Bahn, park nearby"), but **no energy certificate
  data**. The location text may only use these recorded location facts and the district name; no invented claims
  about the neighbourhood (Claude's call; the system prompt says so, the number guard covers the "5 min"). So the demo triggers: room conflict → question, energy certificate missing → question,
  poor photos flagged, likely at least one number-guard repair.

### OpenImmo

Target OpenImmo 1.2.7 (the version portals accept most widely), one `<anbieter>` with one `<immobilie>`:
objektkategorie (Wohnung, miete), geo, preise (kaltmiete), flaechen, ausstattung, zustand_angaben with
energiepass, freitexte (objekttitel, objektbeschreibung, lage, ausstatt_beschr), anhaenge (photo files, cover as
`TITELBILD`), verwaltung_techn. German texts go in `freitexte`; the English version is exported as a second file
or via `user_defined_*` (builder decides; the DE version is the portal one).

### Tests (minimum for tomorrow)

- Number guard: passes on facts from the record, rejects an invented number, handles "1.450 €" / "1,450" / "65 m²".
- `check_listing` reports missing energy-certificate fields; `export_openimmo` refuses then.
- Export of a complete sample draft validates against the XSD.
- Loop with a scripted model: conflict → `ask_broker` → answer recorded → export.

## Tomorrow's priority order (if time runs out, cut from the bottom)

1. Loop + tools + Bedrock end-to-end on the sample, from the CLI.
2. Web page with live steps and `ask_broker`.
3. OpenImmo export validated against XSD.
4. Replay, and a recorded known-good run.
5. Expandable step details, photo grid polish.

## Scope of live inputs (Claude's call)

The sample is what must work reliably on stage. Uploads are supported best-effort: JPEG/PNG/WebP photos (up to
~20), floor plan as PNG/JPEG or single-page PDF. Quality thresholds are tuned on the sample. Time goes into the
sample run and replay first.

## OpenImmo XSD (Claude's call)

A script downloads the official OpenImmo 1.2.7 XSD into a git-ignored folder; the XSD is not committed, because
its licence for redistribution is unclear. The XSD test and the "valid" badge run when the file is present. If it
cannot be obtained, the fallback (hand-written check of the required elements) is used and labelled as such in the
UI.

## Left to the builder

- Exact package layout (may be fewer packages), CSS details, event names.
- XSD validation library (prefer a WASM xmllint over native bindings on Windows).
- Image quality thresholds (tune on the sample so the planted bad photos, and only those, are flagged).
- How the English exposé goes into the export.
- Prompt wording.

## Risks

- **OpenImmo XSD availability/licence:** if the official XSD cannot be obtained in time, validate against a
  hand-written check of the required elements and say so in the demo.
- **Sonnet 5.5 / Opus 5.5 not enabled in the EU profile for the account:** check model access first thing.
- **Latency:** 16 images in one vision call plus several Opus turns; target under ~2 minutes for the full run.
  Replay covers the worst case.
