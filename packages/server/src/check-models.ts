import "./env.js";
import { structuredCall } from "@listing/core";
import { checkerJpeg } from "@listing/core/testing";
import { z } from "zod";
import { BedrockModel, DEFAULT_VISION, missingCredentials } from "./bedrock.js";

// One-shot check that both models are invocable in this account and region, and that vision works.
const missing = missingCredentials();
if (missing) {
  console.error(missing);
  process.exitCode = 1;
}

// A small light-grey checker image.
const PIXEL = (await checkerJpeg(220, 220, 220)).toString("base64");

const orchestrator = new BedrockModel();
const vision = new BedrockModel({ model: process.env.VISION_MODEL ?? DEFAULT_VISION });

const checks: [string, BedrockModel, Parameters<BedrockModel["complete"]>[0]["messages"]][] = [
  ["orchestrator text", orchestrator, [{ role: "user", content: "Reply with OK" }]],
  ["vision text", vision, [{ role: "user", content: "Reply with OK" }]],
  [
    "vision image",
    vision,
    [{ role: "user", content: [{ type: "image", mediaType: "image/jpeg", data: PIXEL }, { type: "text", text: "What colour is this image? One word." }] }],
  ],
];

let failed = false;
for (const [name, model, messages] of checks) {
  const started = performance.now();
  try {
    const res = await model.complete({ system: "Be brief.", tools: [], messages, maxTokens: 2000 });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
    console.log(`OK   ${name.padEnd(18)} ${model.id}  ${Math.round(performance.now() - started)} ms  "${text}"`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${name.padEnd(18)} ${model.id}  ${e instanceof Error ? e.message : String(e)}`);
  }
}

// The path the photo and floor-plan steps use: an image plus one required tool call (auto tool_choice, requested in the prompt).
{
  const started = performance.now();
  try {
    const r = await structuredCall(vision, {
      system: "Describe images.",
      content: [{ type: "image", mediaType: "image/jpeg", data: PIXEL }, { type: "text", text: "Report what this image shows." }],
      toolName: "report_image",
      description: "Report a short description of the image.",
      schema: z.object({ description: z.string() }),
      maxTokens: 1000,
    });
    console.log(`OK   ${"vision forced tool".padEnd(18)} ${vision.id}  ${Math.round(performance.now() - started)} ms  ${JSON.stringify(r)}`);
  } catch (e) {
    failed = true;
    console.log(`FAIL ${"vision forced tool".padEnd(18)} ${vision.id}  ${e instanceof Error ? e.message : String(e)}`);
  }
}
process.exitCode = failed ? 1 : 0;
