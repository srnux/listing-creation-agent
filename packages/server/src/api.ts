import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, relative } from "node:path";
import { isFieldId } from "@listing/core";
import { SAMPLE_DIR } from "@listing/core/testing";
import { z } from "zod";
import type { RunRegistry } from "./runs.js";
import { loadSample, type ListingInput } from "./sample.js";

export interface AppDeps {
  registry: RunRegistry;
  /** Optional replay handler (Task 12): starts a replay of a recorded run and returns its id. */
  replays?: { list(): string[]; start(name: string): string | undefined };
}

const BODY_LIMIT = 80 * 1024 * 1024;
const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".xml": "application/xml" };

const File = z.object({ mediaType: z.string(), data: z.string().min(1) });
const RunBody = z.union([
  z.object({ sample: z.literal(true) }),
  z.object({
    notes: z.string().trim().min(3).max(5000),
    photos: z.array(File.extend({ id: z.string().regex(/^[\w.-]{1,80}$/), mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]) })).min(1).max(30),
    plan: File.extend({ mediaType: z.enum(["image/png", "image/jpeg", "application/pdf"]) }),
  }),
]);
const AnswerBody = z.object({ questionId: z.string(), answer: z.record(z.string(), z.unknown()) });

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_LIMIT) throw new Error("Body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

/** Serves a file only if it is inside root. */
function serveFile(res: ServerResponse, root: string, rel: string): void {
  const file = normalize(join(root, rel));
  const inside = !relative(root, file).startsWith("..") && !relative(root, file).includes(":");
  if (!inside || !existsSync(file) || !statSync(file).isFile()) return json(res, 404, { error: "Not found" });
  res.writeHead(200, { "content-type": TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}

export function createApp(deps: AppDeps): Server {
  const { registry } = deps;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    const parts = path.split("/").filter(Boolean);
    try {
      if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true });

      if (req.method === "GET" && path === "/sample") {
        const s = loadSample();
        const files = readdirSync(join(SAMPLE_DIR, "photos")).filter((f) => extname(f).toLowerCase() in TYPES).sort();
        return json(res, 200, {
          notes: s.notes,
          photos: files.map((f) => ({ id: f.replace(/\.[^.]+$/, ""), url: `/sample/files/photos/${f}` })),
          planUrl: "/sample/files/floorplan.png",
        });
      }
      if (req.method === "GET" && parts[0] === "sample" && parts[1] === "files") return serveFile(res, SAMPLE_DIR, parts.slice(2).join("/"));

      if (req.method === "POST" && path === "/runs") {
        const parsed = RunBody.safeParse(await readJson(req));
        if (!parsed.success) return json(res, 400, { error: z.prettifyError(parsed.error) });
        const body = parsed.data;
        const input: ListingInput =
          "sample" in body
            ? loadSample()
            : {
                notes: body.notes,
                photos: body.photos.map((p) => ({ id: p.id, mediaType: p.mediaType, data: Buffer.from(p.data, "base64") })),
                plan: { mediaType: body.plan.mediaType, data: Buffer.from(body.plan.data, "base64") },
              };
        return json(res, 200, { runId: registry.startLive(input).id });
      }

      if (parts[0] === "runs" && parts[1]) {
        const run = registry.get(parts[1]);
        if (req.method === "POST" && parts[2] === "answers") {
          const parsed = AnswerBody.safeParse(await readJson(req));
          if (!parsed.success) return json(res, 400, { error: z.prettifyError(parsed.error) });
          const answer = Object.fromEntries(Object.entries(parsed.data.answer).filter(([k]) => isFieldId(k)));
          const r = registry.answer(parts[1], parsed.data.questionId, answer);
          if (r === "no_run") return json(res, 404, { error: "Unknown run" });
          if (r === "no_question") return json(res, 409, { error: "No such pending question" });
          res.writeHead(204).end();
          return;
        }
        if (!run) return json(res, 404, { error: "Unknown run" });

        if (req.method === "GET" && parts[2] === "events") {
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const unsubscribe = run.subscribe((e) => {
            res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
            if (e.type === "done") res.end();
          });
          req.on("close", unsubscribe);
          return;
        }
        if (req.method === "GET" && parts[2] === "openimmo.xml") {
          if (!run.xmlFile || !existsSync(run.xmlFile)) return json(res, 404, { error: "Not exported" });
          res.writeHead(200, { "content-type": "application/xml", "content-disposition": 'attachment; filename="openimmo.xml"' });
          createReadStream(run.xmlFile).pipe(res);
          return;
        }
        if (req.method === "GET" && parts[2] === "photos" && parts[3]) {
          const photo = run.photos.find((p) => p.id === parts[3]);
          if (!photo) return json(res, 404, { error: "Unknown photo" });
          res.writeHead(200, { "content-type": photo.mediaType, "cache-control": "max-age=3600" });
          res.end(photo.data);
          return;
        }
      }

      if (deps.replays && req.method === "GET" && path === "/replays") return json(res, 200, { replays: deps.replays.list() });
      if (deps.replays && req.method === "POST" && parts[0] === "replays" && parts[1]) {
        const runId = deps.replays.start(parts[1]);
        return runId ? json(res, 200, { runId }) : json(res, 404, { error: "Unknown replay" });
      }

      json(res, 404, { error: "Not found" });
    } catch (e) {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: e instanceof Error ? e.message : String(e) });
      else res.end();
    }
  });
}
