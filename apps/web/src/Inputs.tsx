import type { Sample } from "./api";

export type Mode = "live" | "replay";

export interface InputState {
  notes: string;
  /** Thumbnails to show: sample URLs or object URLs of uploads. */
  photos: { id: string; url: string; file?: File }[];
  plan?: { url: string; file?: File };
  fromSample: boolean;
}

export function Inputs(props: {
  input: InputState;
  setInput(i: InputState): void;
  sample?: Sample;
  mode: Mode;
  setMode(m: Mode): void;
  replays: string[];
  replay: string;
  setReplay(r: string): void;
  running: boolean;
  onRun(): void;
}) {
  const { input, setInput, mode } = props;
  const loadSample = () =>
    props.sample && setInput({ notes: props.sample.notes, photos: props.sample.photos, plan: { url: props.sample.planUrl }, fromSample: true });
  const addPhotos = (files: FileList | null) =>
    files &&
    setInput({
      ...input,
      fromSample: false,
      photos: [...input.photos.filter((p) => p.file), ...[...files].map((f) => ({ id: f.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]/g, "_"), url: URL.createObjectURL(f), file: f }))],
    });
  const canRun = mode === "replay" ? !!props.replay : input.photos.length > 0 && !!input.plan && input.notes.trim().length >= 3;

  return (
    <section className="pane inputs-pane" aria-labelledby="inputs-title">
      <h2 id="inputs-title">From the viewing</h2>
      <div className="row">
        <button className="chip" onClick={loadSample} disabled={!props.sample}>
          Load sample flat
        </button>
        <label className="chip file-chip">
          Photos…
          <input type="file" accept="image/*" multiple onChange={(e) => addPhotos(e.target.files)} />
        </label>
        <label className="chip file-chip">
          Floor plan…
          <input
            type="file"
            accept="image/png,image/jpeg,application/pdf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setInput({ ...input, fromSample: false, plan: { url: URL.createObjectURL(f), file: f } });
            }}
          />
        </label>
      </div>

      <label className="label" htmlFor="notes">
        Notes
      </label>
      <textarea
        id="notes"
        rows={5}
        value={input.notes}
        onChange={(e) => setInput({ ...input, notes: e.target.value, fromSample: input.fromSample && e.target.value === props.sample?.notes })}
        placeholder="3 Zimmer, 2. OG, Küche neu 2023, Balkon Süd, 1.450 € kalt"
      />

      {input.photos.length > 0 && (
        <>
          <p className="label">{input.photos.length} photos</p>
          <ul className="thumbs">
            {input.photos.map((p) => (
              <li key={p.id}>
                <img src={p.url} alt={p.id} title={p.id} loading="lazy" />
              </li>
            ))}
          </ul>
        </>
      )}
      {input.plan && (
        <>
          <p className="label">Floor plan</p>
          {input.plan.file?.type === "application/pdf" ? <p>{input.plan.file.name}</p> : <img className="plan" src={input.plan.url} alt="Floor plan" />}
        </>
      )}

      <fieldset className="mode">
        <legend className="label">Mode</legend>
        <label>
          <input type="radio" name="mode" checked={mode === "live"} onChange={() => props.setMode("live")} /> Live on Bedrock
        </label>
        <label>
          <input type="radio" name="mode" checked={mode === "replay"} onChange={() => props.setMode("replay")} /> Replay
        </label>
        {mode === "replay" && (
          <select value={props.replay} onChange={(e) => props.setReplay(e.target.value)} aria-label="Recorded run">
            {props.replays.length === 0 && <option value="">No recorded runs</option>}
            {props.replays.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
      </fieldset>

      <button className="solid run" onClick={props.onRun} disabled={!canRun}>
        {props.running ? "Restart" : "Create listing"}
      </button>
    </section>
  );
}
