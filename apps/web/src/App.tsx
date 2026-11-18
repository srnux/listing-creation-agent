import type { BrokerAnswer } from "@listing/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { answer, fileToPayload, getSample, listReplays, startReplay, startRun, subscribe, type Sample, type TimedEvent } from "./api";
import { Inputs, type InputState, type Mode } from "./Inputs";
import { Result } from "./Result";
import { Steps } from "./Steps";
import { view } from "./view";

export function App() {
  const [sample, setSample] = useState<Sample>();
  const [input, setInput] = useState<InputState>({ notes: "", photos: [], fromSample: false });
  const [mode, setMode] = useState<Mode>("live");
  const [replays, setReplays] = useState<string[]>([]);
  const [replay, setReplay] = useState("");
  const [runId, setRunId] = useState<string>();
  const [events, setEvents] = useState<TimedEvent[]>([]);
  const [error, setError] = useState<string>();
  const [server, setServer] = useState<"unknown" | "up" | "down">("unknown");
  const stop = useRef<() => void>(undefined);

  useEffect(() => {
    getSample()
      .then((s) => {
        setSample(s);
        setServer("up");
      })
      .catch(() => setServer("down"));
    listReplays()
      .then((r) => {
        setReplays(r);
        setReplay(r.includes("known-good") ? "known-good" : (r[0] ?? ""));
      })
      .catch(() => {});
    return () => stop.current?.();
  }, []);

  const run = useMemo(() => (runId ? view(events) : undefined), [runId, events]);
  const running = !!runId && !run?.done && !error;

  const onRun = async () => {
    stop.current?.();
    setEvents([]);
    setError(undefined);
    setRunId(undefined);
    try {
      let id: string;
      if (mode === "replay") id = await startReplay(replay);
      else if (input.fromSample) id = await startRun({ sample: true });
      else {
        const photos = await Promise.all(input.photos.filter((p) => p.file).map(async (p) => ({ id: p.id, ...(await fileToPayload(p.file!)) })));
        const planFile = input.plan?.file;
        if (!planFile) throw new Error("Add a floor plan.");
        const plan = planFile.type === "application/pdf" ? await fileToPayload(planFile) : { ...(await fileToPayload(planFile)), mediaType: "image/jpeg" };
        id = await startRun({ notes: input.notes, photos, plan });
      }
      setRunId(id);
      stop.current = subscribe(id, (e) => setEvents((all) => [...all, e]), setError);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAnswer = async (questionId: string, a: BrokerAnswer) => {
    if (runId) await answer(runId, questionId, a);
  };

  return (
    <div className="desk">
      <header className="masthead" data-theme="dark">
        <div>
          <h1>Listing desk</h1>
          <p className="lede">Photos, a floor plan and a few notes become a bilingual exposé and an OpenImmo export. The agent writes only from the record and asks the broker about everything else.</p>
        </div>
        <p className="model label" data-status={server === "down" ? "alarm" : server === "up" ? "ok" : undefined}>
          {server === "down" ? "Server not reachable" : mode === "replay" ? "Replay of a recorded run" : "Live · Amazon Bedrock"}
        </p>
      </header>
      {error && (
        <p className="banner note" data-status="alarm" role="alert">
          {error} {mode === "live" && "Switch to Replay to show a recorded run."}
        </p>
      )}
      <main className="panes">
        <Inputs input={input} setInput={setInput} sample={sample} mode={mode} setMode={setMode} replays={replays} replay={replay} setReplay={setReplay} running={running} onRun={onRun} />
        <Steps run={run} running={running} onAnswer={onAnswer} />
        <Result run={run} runId={runId} />
      </main>
    </div>
  );
}
