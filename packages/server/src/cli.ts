import "./env.js";
import { mkdirSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { FIELD_LABELS, FIELD_SCHEMAS, ListingDraft, runListing, type BrokerAnswer, type BrokerQuestion, type FieldId, type RunEvent } from "@listing/core";
import { BedrockModel, DEFAULT_VISION, missingCredentials } from "./bedrock.js";
import { loadSample, loadTone, sampleAnswer } from "./sample.js";

// Runs the sample flat from the terminal. `pnpm sample` asks you the broker's questions; `pnpm sample --auto` answers them.
const auto = process.argv.includes("--auto");
const missing = missingCredentials();
if (missing) {
  console.error(missing);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = fileURLToPath(new URL(`../../../out/${stamp}/`, import.meta.url));
mkdirSync(outDir, { recursive: true });

const rl = createInterface({ input: process.stdin, output: process.stdout });

/** Converts typed text to the field's type: numbers accept "1.450" and "82,5"; booleans accept ja/nein. */
function convert(field: FieldId, raw: string): unknown {
  const schema = FIELD_SCHEMAS[field];
  const t = raw.trim();
  if (schema.def.type === "number") return Number(t.replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
  if (schema.def.type === "boolean") return /^(ja|j|yes|y|true)$/i.test(t);
  if (schema.def.type === "array") return t.split(";").map((s) => s.trim()).filter(Boolean);
  return t;
}

async function ask(q: BrokerQuestion): Promise<BrokerAnswer> {
  console.log(`\n? ${q.question}${q.context ? `\n  (${q.context})` : ""}`);
  if (auto) {
    const a = sampleAnswer(q.fields);
    console.log(`  auto: ${JSON.stringify(a)}`);
    return a;
  }
  const answer: BrokerAnswer = {};
  for (const f of q.fields) {
    const schema = FIELD_SCHEMAS[f];
    const choices = schema.def.type === "enum" ? ` [${(schema as unknown as { options: string[] }).options.join("/")}]` : "";
    answer[f] = convert(f, await rl.question(`  ${FIELD_LABELS[f].de}${choices}: `));
  }
  return answer;
}

const print = (e: RunEvent) => {
  switch (e.type) {
    case "model":
      console.log(`\n  ${e.text.replace(/\n/g, "\n  ")}`);
      break;
    case "tool_start":
      console.log(`→ ${e.tool}`);
      break;
    case "tool_end":
      console.log(`${e.isError ? "✗" : "✓"} ${e.tool}: ${e.summary} (${(e.durationMs / 1000).toFixed(1)} s)`);
      break;
    case "done":
      console.log(`\n${JSON.stringify(e.outcome)}\nTokens: ${e.usage.inputTokens} in, ${e.usage.outputTokens} out, ${e.usage.cacheReadTokens} cache read`);
      break;
  }
};

const input = loadSample();
const started = performance.now();
const { outcome } = await runListing({
  model: new BedrockModel(),
  ctx: {
    draft: new ListingDraft(input.notes),
    photos: input.photos,
    plan: input.plan,
    visionModel: new BedrockModel({ model: process.env.VISION_MODEL ?? DEFAULT_VISION }),
    askBroker: ask,
    outDir,
  },
  tone: loadTone(),
  onEvent: print,
});
console.log(`Wall clock: ${((performance.now() - started) / 1000).toFixed(0)} s. Output: ${outDir}`);
rl.close();
process.exitCode = outcome.status === "exported" ? 0 : 1;
