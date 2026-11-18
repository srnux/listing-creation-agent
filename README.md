# listing-creation-agent

An AI agent on Amazon Bedrock that turns what a broker brings back from a viewing (photos, a floor plan and a few
rough notes) into a portal-ready listing: a German and an English exposé and an OpenImmo 1.2.7 XML export.

The rule it follows: **write only from the record; ask the broker about everything else.** The rule lives in the
tools, not only in the prompt:

- Facts carry their source (notes, floor plan, photo, broker).
- A conflict ("notes say 3 rooms, the plan shows 4") or a missing required field (the energy certificate, which
  GEG §87 requires in ads) becomes a question to the broker, answered in a typed form.
- Every number in the exposé is checked in code against the record; an invented one is rejected and the agent
  has to fix the text.
- The export refuses while anything required is missing.

All data is synthetic or stock (see [data/sample/CREDITS.md](data/sample/CREDITS.md)). The agency is fictional.

## Quick start

```bash
pnpm install
cp .env.example .env      # set AWS_REGION and AWS_BEARER_TOKEN_BEDROCK (or use your AWS profile)
pnpm check-models         # Opus 5.5 and Sonnet 5.5 reachable in the EU profile?
pnpm dev                  # page on http://localhost:5173, API on 127.0.0.1:3000
```

From the terminal instead: `pnpm sample` (you answer the questions) or `pnpm sample --auto` (sample answers).

Tests run offline with scripted models: `pnpm test`, `pnpm typecheck`. A live check of the vision calls:
`LIVE=1 pnpm vitest run vision-live`.

## How it works

```
packages/core     record (facts + sources), photo checks (sharp), vision calls, number guard, OpenImmo, tools, loop
packages/server   Bedrock adapter, HTTP API with live events (SSE), run registry, replay, CLI
apps/web          the three-pane page: inputs · what the agent does · result
data/sample       13 stock photos + 3 planted bad ones, a floor plan, notes, the agency tone guide
```

- **Orchestrator:** Claude Opus 5.5 (`eu.anthropic.claude-opus-5-5`) runs a plain tool-use loop and decides the order.
- **Vision:** Claude Sonnet 5.5 reads all photos in one call and the floor plan in another, inside the tools.
  Dark, blurry and duplicate photos are found by code first (brightness, Laplacian variance, perceptual hash);
  the model cannot pick a flagged photo as the cover.
- **Tools:** `record_facts`, `analyze_photos`, `read_floor_plan`, `compare_sources`, `check_listing`,
  `ask_broker`, `submit_expose`, `export_openimmo`.
- **OpenImmo:** validated against the official XSD if you put it at `schemas/openimmo_127b.xsd` (its license
  forbids redistribution, so it is not in the repo; `pnpm fetch-xsd` explains). Otherwise a structural check of the
  required elements runs, and the page says so.
- **Replay:** every finished run is saved to `runs/`. Copy a good one to `runs/known-good.json` (and its `.xml`) and
  the page can replay it with the original timing, in case Bedrock is slow or down on stage.

## Demo script (about three minutes)

1. **Load sample flat.** 16 photos, the floor plan, the notes "3 Zimmer, 2. OG, Küche neu 2023, Balkon Süd,
   1.450 € kalt". No living area, no energy data.
2. **Create listing.** Point at the middle pane: each step appears as the agent takes it.
3. **Photos:** three are greyed out on the right (dark, blurry, duplicate), found by code, not by the model.
4. **The room conflict:** the agent asks "notes say 3, plan shows 4". Answer **4**.
5. **The energy certificate:** one form for all six fields. Answer: Verbrauch, 112, Fernwärme, 1962, D,
   2032-05-31. Try "ca. 120" in the value field first to show the form rejects it.
6. **The exposé:** if a red "rejected, not in the record" step appears, that is the number check catching an
   invented figure; the agent fixes it. Switch Deutsch / English.
7. **Download the XML,** show the validation badge and the record with a source on every fact.
8. **For the developers:** open any step to see its input and output.

**Fallback:** switch Mode to Replay → `known-good` → Create listing. The form comes prefilled with the recorded
answers.
