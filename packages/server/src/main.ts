import "./env.js";
import { fileURLToPath } from "node:url";
import { createApp } from "./api.js";
import { BedrockModel, DEFAULT_VISION, missingCredentials } from "./bedrock.js";
import { createReplays } from "./replay.js";
import { RunRegistry } from "./runs.js";
import { loadTone } from "./sample.js";

const root = (p: string) => fileURLToPath(new URL(`../../../${p}`, import.meta.url));

const missing = missingCredentials();
if (missing) console.warn(`${missing} Live runs will fail; replay still works.`);

const registry = new RunRegistry({
  model: () => new BedrockModel(),
  vision: () => new BedrockModel({ model: process.env.VISION_MODEL ?? DEFAULT_VISION }),
  tone: loadTone(),
  outRoot: root("out"),
  runsDir: root("runs"),
});
const replays = createReplays(registry, root("runs"));

const port = Number(process.env.PORT ?? 3000);
createApp({ registry, replays }).listen(port, "127.0.0.1", () => {
  console.log(`API on http://127.0.0.1:${port}`);
});
