import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ListingDraft,
  runListing,
  type BrokerAnswer,
  type BrokerQuestion,
  type Limits,
  type ModelClient,
  type Photo,
  type RunEvent,
} from "@listing/core";
import type { ListingInput } from "./sample.js";

export type TimedEvent = RunEvent & { t: number };

export interface RegistryDeps {
  model(): ModelClient;
  vision(): ModelClient;
  tone: string;
  /** Exports go to <outRoot>/<runId>/. */
  outRoot: string;
  /** Finished runs are recorded to <runsDir>/<timestamp>.json. */
  runsDir: string;
  limits?: Partial<Limits>;
}

interface Pending {
  question: BrokerQuestion;
  resolve(a: BrokerAnswer): void;
  reject(e: unknown): void;
}

/** One run: its events so far, live subscribers, and the question it waits on. */
export class Run {
  readonly events: TimedEvent[] = [];
  readonly controller = new AbortController();
  readonly startedAt = new Date();
  private readonly started = performance.now();
  private readonly listeners = new Set<(e: TimedEvent) => void>();
  readonly pending = new Map<string, Pending>();
  /** Set when the run exported; the file the download route serves. */
  xmlFile?: string;

  constructor(
    readonly id: string,
    readonly photos: Photo[],
    readonly outDir: string,
    readonly kind: "live" | "replay",
  ) {}

  get finished(): boolean {
    return this.events.at(-1)?.type === "done";
  }

  push(e: RunEvent): void {
    const timed = { ...e, t: Math.round(performance.now() - this.started) } as TimedEvent;
    this.events.push(timed);
    if (e.type === "done" && e.outcome.status === "exported") this.xmlFile = e.outcome.file;
    for (const l of this.listeners) l(timed);
  }

  /** Replays the events so far, then streams new ones. Returns the unsubscribe function. */
  subscribe(listener: (e: TimedEvent) => void): () => void {
    this.events.forEach(listener);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Waits for the broker's answer to this question; rejects if the run is aborted. */
  ask(question: BrokerQuestion): Promise<BrokerAnswer> {
    return new Promise((resolve, reject) => {
      if (this.controller.signal.aborted) return reject(this.controller.signal.reason);
      this.pending.set(question.id, { question, resolve, reject });
    });
  }

  answer(questionId: string, answer: BrokerAnswer): boolean {
    const p = this.pending.get(questionId);
    if (!p) return false;
    this.pending.delete(questionId);
    p.resolve(answer);
    return true;
  }

  abort(reason: string): void {
    const err = new Error(reason);
    this.controller.abort(err);
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

const stamp = (d: Date) => d.toISOString().replace(/[:.]/g, "-");

/** Keeps runs by id. One active run at a time: starting one aborts the previous. */
export class RunRegistry {
  private readonly runs = new Map<string, Run>();
  private active?: Run;
  private counter = 0;

  constructor(readonly deps: RegistryDeps) {}

  get(id: string): Run | undefined {
    return this.runs.get(id);
  }

  answer(runId: string, questionId: string, answer: BrokerAnswer): "ok" | "no_run" | "no_question" {
    const run = this.runs.get(runId);
    if (!run) return "no_run";
    return run.answer(questionId, answer) ? "ok" : "no_question";
  }

  /** Creates a run, aborting the active one. Used by live runs and replays. */
  create(kind: Run["kind"], photos: Photo[]): Run {
    if (this.active && !this.active.finished) this.active.abort("superseded by a new run");
    const id = `r${++this.counter}-${Date.now().toString(36)}`;
    const outDir = join(this.deps.outRoot, id);
    mkdirSync(outDir, { recursive: true });
    const run = new Run(id, photos, outDir, kind);
    this.runs.set(id, run);
    this.active = run;
    return run;
  }

  startLive(input: ListingInput): Run {
    const run = this.create("live", input.photos);
    void runListing({
      model: this.deps.model(),
      ctx: {
        draft: new ListingDraft(input.notes),
        photos: input.photos,
        plan: input.plan,
        visionModel: this.deps.vision(),
        askBroker: (q) => run.ask(q),
        outDir: run.outDir,
      },
      tone: this.deps.tone,
      limits: this.deps.limits,
      signal: run.controller.signal,
      onEvent: (e) => {
        run.push(e);
        if (e.type === "done") this.record(run);
      },
    }).catch((e) => {
      // runListing never throws; this is a last resort so a run cannot hang.
      console.error("Run crashed:", e);
      if (!run.finished) run.push({ type: "done", outcome: { status: "failed", reason: String(e) }, draft: { notes: input.notes, facts: [] }, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } });
    });
    return run;
  }

  private record(run: Run): void {
    try {
      mkdirSync(this.deps.runsDir, { recursive: true });
      const file = join(this.deps.runsDir, `${stamp(run.startedAt)}.json`);
      writeFileSync(file, JSON.stringify({ startedAt: run.startedAt.toISOString(), events: run.events }));
      if (run.xmlFile) {
        // The download in a replay serves the XML this run produced.
        writeFileSync(file.replace(/\.json$/, ".xml"), readFileSync(run.xmlFile));
      }
    } catch (e) {
      console.error("Could not record run:", e);
    }
  }
}
