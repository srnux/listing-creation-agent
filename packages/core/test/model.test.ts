import { expect, test } from "vitest";
import { z } from "zod";
import { call, say, structuredCall, StructuredCallError } from "../src/model.js";
import { ScriptedModel } from "../src/testing.js";

const schema = z.object({ n: z.number() });
const opts = { system: "s", content: [say("x")], toolName: "report", description: "d", schema };

test("structuredCall forces the tool and returns parsed input", async () => {
  const model = new ScriptedModel([
    (req) => {
      expect(req.toolChoice).toEqual({ name: "report" });
      expect(req.tools[0]!.name).toBe("report");
      expect(req.tools[0]!.inputSchema).toMatchObject({ type: "object" });
      return [call("report", { n: 3 })];
    },
  ]);
  expect(await structuredCall(model, opts)).toEqual({ n: 3 });
});

test("structuredCall throws StructuredCallError on invalid input", async () => {
  const model = new ScriptedModel([[call("report", { n: "three" })]]);
  await expect(structuredCall(model, opts)).rejects.toThrow(StructuredCallError);
});

test("structuredCall throws StructuredCallError when the model answers in text", async () => {
  const model = new ScriptedModel([[say("no tool")]]);
  await expect(structuredCall(model, opts)).rejects.toThrow(StructuredCallError);
});
