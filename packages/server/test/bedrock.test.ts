import { afterEach, expect, test } from "vitest";
import { BedrockModel, type MessagesClient } from "../src/bedrock.js";

const fakeClient = () => {
  const requests: any[] = [];
  const client: MessagesClient = {
    beta: {
      messages: {
        create: (async (params: any) => {
          requests.push(params);
          return {
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          };
        }) as any,
      },
    },
  };
  return { client, requests };
};

const saved = process.env.ORCHESTRATOR_MODEL;
afterEach(() => {
  if (saved === undefined) delete process.env.ORCHESTRATOR_MODEL;
  else process.env.ORCHESTRATOR_MODEL = saved;
});

test("image and document blocks map to Messages API params", async () => {
  const { client, requests } = fakeClient();
  await new BedrockModel({ client }).complete({
    system: "s",
    tools: [],
    maxTokens: 10,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", mediaType: "image/jpeg", data: "AAA" },
          { type: "document", mediaType: "application/pdf", data: "BBB" },
        ],
      },
    ],
  });
  expect(requests[0].messages[0].content).toEqual([
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAA" } },
    { type: "document", source: { type: "base64", media_type: "application/pdf", data: "BBB" } },
  ]);
});

test("toolChoice asks for the tool with auto choice (5.5 models reject forced tool_choice)", async () => {
  const { client, requests } = fakeClient();
  await new BedrockModel({ client }).complete({
    system: "s",
    tools: [{ name: "report", description: "d", inputSchema: { type: "object" } }],
    toolChoice: { name: "report" },
    maxTokens: 10,
    messages: [{ role: "user", content: "x" }],
  });
  expect(requests[0].tool_choice).toEqual({ type: "auto", disable_parallel_tool_use: true });
  expect(requests[0].system.at(-1).text).toContain("report");
  expect(requests[0].output_config).toEqual({ effort: "medium" });
});

test("defaults to eu.anthropic.claude-opus-5-5 when ORCHESTRATOR_MODEL is unset", () => {
  delete process.env.ORCHESTRATOR_MODEL;
  expect(new BedrockModel({ client: fakeClient().client }).id).toBe("eu.anthropic.claude-opus-5-5");
});
