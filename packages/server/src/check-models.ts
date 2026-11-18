import "./env.js";
import { BedrockModel, DEFAULT_VISION, missingCredentials } from "./bedrock.js";

// One-shot check that both models are invocable in this account and region, and that vision works.
const missing = missingCredentials();
if (missing) {
  console.error(missing);
  process.exitCode = 1;
}

// A 1×1 white JPEG.
const PIXEL =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=";

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
process.exitCode = failed ? 1 : 0;
