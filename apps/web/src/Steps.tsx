import { FIELD_LABELS } from "@listing/core/fields";
import type { BrokerAnswer } from "@listing/core";
import { QuestionForm } from "./QuestionForm";
import { TOOL_LABELS, type RunView } from "./view";

const json = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 2));

export function Steps({ run, running, onAnswer }: { run?: RunView; running: boolean; onAnswer(questionId: string, a: BrokerAnswer): Promise<void> }) {
  return (
    <section className="pane steps-pane" aria-labelledby="steps-title">
      <h2 id="steps-title">What the agent does</h2>
      {!run && <p className="empty">Each step appears here as it runs. Click a step to see what went in and what came out.</p>}
      {run && (
        <ol className="steps">
          {run.items.map((item) => {
            if (item.kind === "model")
              return (
                <li key={item.key} className="step is-model">
                  <p>{item.text}</p>
                </li>
              );
            if (item.kind === "question") {
              const open = run.pending?.id === item.question.id;
              return (
                <li key={item.key} className={`step is-question${item.superseded ? " is-superseded" : ""}`}>
                  <p className="step-tool">
                    <span className="status" data-status="handoff">
                      Question
                    </span>{" "}
                    {item.question.question}
                  </p>
                  {item.question.context && <p className="question-context">{item.question.context}</p>}
                  {open && <QuestionForm question={item.question} prefill={item.prefill} onSubmit={(a) => onAnswer(item.question.id, a)} />}
                  {item.answer && (
                    <p className="answered">
                      Answered:{" "}
                      {Object.entries(item.answer)
                        .map(([f, v]) => `${FIELD_LABELS[f as keyof typeof FIELD_LABELS]?.de ?? f}: ${Array.isArray(v) ? v.join("; ") : String(v)}`)
                        .join(", ")}
                    </p>
                  )}
                </li>
              );
            }
            const state = !item.end ? "running" : item.end.isError ? "alarm" : "ok";
            return (
              <li key={item.key} className={`step is-tool${item.end?.isError ? " is-error" : ""}`}>
                <details>
                  <summary>
                    <span className="status" data-status={state === "running" ? undefined : state}>
                      {state === "running" ? "…" : state === "ok" ? "✓" : "✗"}
                    </span>
                    <span className="step-tool">{TOOL_LABELS[item.tool] ?? item.tool}</span>
                    <span className="step-summary">{item.end?.summary ?? "running"}</span>
                    {item.end && <span className="step-meta">{(item.end.durationMs / 1000).toFixed(1)} s</span>}
                  </summary>
                  <h3>Input</h3>
                  <pre>{json(item.input)}</pre>
                  {item.end && (
                    <>
                      <h3>Result</h3>
                      <pre>{json(item.end.result)}</pre>
                    </>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      )}
      {run && running && !run.pending && <p className="empty working">Working…</p>}
      {run?.done && (
        <p className="usage label">
          {(run.elapsedMs / 1000).toFixed(0)} s · {run.done.usage.inputTokens + run.done.usage.cacheReadTokens} tokens in ({run.done.usage.cacheReadTokens} from cache), {run.done.usage.outputTokens} out
        </p>
      )}
    </section>
  );
}
