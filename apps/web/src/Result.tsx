import { FIELD_LABELS, type FieldId } from "@listing/core/fields";
import { useState } from "react";
import type { RunView } from "./view";

const SOURCE_LABEL = (s: string) => (s === "notes" ? "notes" : s === "floor_plan" ? "plan" : s === "broker" ? "broker" : "photo");
const show = (v: unknown) => (Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? (v ? "ja" : "nein") : String(v));

export function Result({ run, runId }: { run?: RunView; runId?: string }) {
  const [lang, setLang] = useState<"de" | "en">("de");
  const outcome = run?.done?.outcome;
  const text = run?.expose?.[lang];

  return (
    <section className="pane result-pane" aria-labelledby="result-title">
      <h2 id="result-title">Result</h2>
      {!run && <p className="empty">The sorted photos, the exposé and the OpenImmo export appear here.</p>}

      {outcome && (
        <div className="outcome">
          {outcome.status === "exported" ? (
            <>
              <a className="solid" href={`/runs/${runId}/openimmo.xml`} download="openimmo.xml">
                Download OpenImmo XML
              </a>
              <span className="status" data-status={outcome.valid ? "ok" : "alarm"}>
                {outcome.valid ? (outcome.mode === "xsd" ? "valid against XSD 1.2.7" : "passes structural check (no XSD)") : "invalid"}
              </span>
            </>
          ) : (
            <p className="note" data-status="alarm">
              {outcome.status === "failed" ? "Failed: " : "Not exported: "}
              {outcome.reason}
            </p>
          )}
        </div>
      )}

      {run?.photos && runId && (
        <>
          <h3>Photos, in suggested order</h3>
          <ul className="photo-grid">
            {run.photos.order.map((id) => {
              const p = run.photos!.photos.find((x) => x.id === id);
              if (!p) return null;
              return (
                <li key={id} className={p.quality === "poor" ? "is-poor" : ""}>
                  <img src={`/runs/${runId}/photos/${id}`} alt={`${p.room}, ${id}`} loading="lazy" />
                  <span className="photo-caption">
                    {id === run.photos!.coverId && (
                      <span className="status" data-status="ok">
                        Cover
                      </span>
                    )}{" "}
                    {p.room}
                    {p.quality === "poor" && <span className="photo-reason">{p.reasons.join(", ")}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {text && (
        <article className="expose">
          <div className="tabs" role="tablist">
            {(["de", "en"] as const).map((l) => (
              <button key={l} role="tab" aria-selected={lang === l} className={lang === l ? "chip is-on" : "chip"} onClick={() => setLang(l)}>
                {l === "de" ? "Deutsch" : "English"}
              </button>
            ))}
          </div>
          <h3 className="expose-title">{text.title}</h3>
          {text.description.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <h4>{lang === "de" ? "Lage" : "Location"}</h4>
          <p>{text.location}</p>
          <h4>{lang === "de" ? "Ausstattung" : "Features"}</h4>
          <ul className="features">
            {text.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </article>
      )}

      {run?.done && (
        <>
          <h3>The record</h3>
          <table className="facts">
            <tbody>
              {run.done.draft.facts.map((f) => (
                <tr key={f.field}>
                  <th scope="row">{FIELD_LABELS[f.field as FieldId]?.de ?? f.field}</th>
                  <td>{show(f.value)}</td>
                  <td>
                    <span className={`source source-${SOURCE_LABEL(f.source)}`}>{SOURCE_LABEL(f.source)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
