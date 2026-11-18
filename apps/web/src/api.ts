import type { BrokerAnswer, RunEvent } from "@listing/core";

export type TimedEvent = RunEvent & { t: number };

export interface Sample {
  notes: string;
  photos: { id: string; url: string }[];
  planUrl: string;
}

export interface FilePayload {
  mediaType: string;
  data: string;
}

export interface UploadBody {
  notes: string;
  photos: (FilePayload & { id: string })[];
  plan: FilePayload;
}

const EVENT_TYPES: RunEvent["type"][] = ["model", "tool_start", "tool_end", "question", "answer", "done"];

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const getSample = async (): Promise<Sample> => (await fetch("/sample")).json();
export const listReplays = async (): Promise<string[]> => ((await (await fetch("/replays")).json()) as { replays: string[] }).replays;
export const startRun = async (body: { sample: true } | UploadBody): Promise<string> => (await post<{ runId: string }>("/runs", body)).runId;
export const startReplay = async (name: string): Promise<string> => (await post<{ runId: string }>(`/replays/${encodeURIComponent(name)}`, {})).runId;
export const answer = (runId: string, questionId: string, a: BrokerAnswer) => post<void>(`/runs/${runId}/answers`, { questionId, answer: a });

/** Streams a run's events (past ones first). Returns a function that stops listening. */
export function subscribe(runId: string, onEvent: (e: TimedEvent) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/runs/${runId}/events`);
  let finished = false;
  for (const type of EVENT_TYPES) {
    source.addEventListener(type, (m) => {
      const e = JSON.parse((m as MessageEvent<string>).data) as TimedEvent;
      onEvent(e);
      if (e.type === "done") {
        finished = true;
        source.close();
      }
    });
  }
  source.onerror = () => {
    if (finished) return;
    source.close();
    onError("Lost the connection to the server.");
  };
  return () => source.close();
}

const readAsBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/** Images are scaled to a 2000 px long edge as JPEG in the browser, so 16 phone photos stay well under the body limit. */
export async function fileToPayload(file: File): Promise<FilePayload> {
  if (!file.type.startsWith("image/")) return { mediaType: file.type, data: await readAsBase64(file) };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return { mediaType: "image/jpeg", data: await readAsBase64(blob) };
}
