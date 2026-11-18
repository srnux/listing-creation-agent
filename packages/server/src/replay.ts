import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrokerAnswer, BrokerQuestion, RunEvent } from "@listing/core";
import type { RunRegistry, TimedEvent } from "./runs.js";
import { loadSample } from "./sample.js";

export interface ReplayOptions {
  /** 2 plays twice as fast. */
  speed: number;
  /** Resolves when the presenter submits the (prefilled) form. */
  waitForAnswer(q: BrokerQuestion): Promise<void>;
  signal?: AbortSignal;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });

/** Resolves with the promise, or rejects when the signal aborts; leaves no timer behind. */
const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> =>
  !signal
    ? promise
    : new Promise<T>((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
      });

/** Plays a recorded run with its original timing. A question waits for the presenter; the human wait is skipped. */
export async function replayRun(file: string, emit: (e: RunEvent) => void, opts: ReplayOptions): Promise<void> {
  const { events } = JSON.parse(readFileSync(file, "utf8")) as { events: TimedEvent[] };
  const answers = new Map<string, BrokerAnswer>();
  for (const e of events) if (e.type === "answer") answers.set(e.questionId, e.answer);

  let prevT = events[0]?.t ?? 0;
  for (let i = 0; i < events.length; i++) {
    const { t, ...event } = events[i]!;
    await sleep(Math.max(0, t - prevT) / opts.speed, opts.signal);
    prevT = t;
    if (event.type === "question") {
      emit({ ...event, prefill: answers.get(event.question.id) });
      await untilAborted(opts.waitForAnswer(event.question), opts.signal);
      // Skip the time the broker took in the recording.
      prevT = events[i + 1]?.t ?? prevT;
      continue;
    }
    emit(event as RunEvent);
  }
}

/** The replay routes: recorded runs in runsDir, played into a run of the registry. */
export function createReplays(registry: RunRegistry, runsDir: string) {
  return {
    list(): string[] {
      if (!existsSync(runsDir)) return [];
      const names = readdirSync(runsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.slice(0, -5))
        .sort()
        .reverse();
      return [...names.filter((n) => n === "known-good"), ...names.filter((n) => n !== "known-good")];
    },
    start(name: string): string | undefined {
      if (!/^[\w.-]+$/.test(name)) return undefined;
      const file = join(runsDir, `${name}.json`);
      if (!existsSync(file)) return undefined;
      // Recordings are of the sample flat, so the result pane shows the sample photos.
      const run = registry.create("replay", loadSample().photos);
      const xml = join(runsDir, `${name}.xml`);
      void replayRun(
        file,
        (e) => {
          run.push(e);
          if (e.type === "done" && existsSync(xml)) run.xmlFile = xml;
        },
        {
          speed: Number(process.env.REPLAY_SPEED ?? 1.5),
          waitForAnswer: (q) => run.ask(q).then(() => undefined),
          signal: run.controller.signal,
        },
      ).catch((e) => {
        if (!run.controller.signal.aborted) console.error("Replay failed:", e);
      });
      return run.id;
    },
  };
}
