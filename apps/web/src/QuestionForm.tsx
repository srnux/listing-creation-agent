import { FIELD_LABELS, type FieldId } from "@listing/core/fields";
import type { BrokerAnswer, BrokerQuestion } from "@listing/core";
import { useState } from "react";
import { enumOptions, fieldKind, parseAnswer } from "./answer";

const display = (v: unknown) => (Array.isArray(v) ? v.join("; ") : typeof v === "boolean" ? (v ? "ja" : "nein") : String(v ?? ""));

export function QuestionForm({ question, prefill, onSubmit }: { question: BrokerQuestion; prefill?: BrokerAnswer; onSubmit(a: BrokerAnswer): Promise<void> }) {
  const [raw, setRaw] = useState<Record<string, string>>(() => Object.fromEntries(question.fields.map((f) => [f, display(prefill?.[f])])));
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({});
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string>();

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const r = parseAnswer(question.fields, raw);
    setErrors(r.errors);
    if (!r.answer) return;
    setSending(true);
    setFailed(undefined);
    try {
      await onSubmit(r.answer);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  };

  return (
    <form className="question-form" onSubmit={submit} noValidate>
      {question.fields.map((f) => {
        const kind = fieldKind(f);
        const id = `${question.id}-${f}`;
        const set = (value: string) => setRaw((r) => ({ ...r, [f]: value }));
        return (
          <div className="field" key={f}>
            <label htmlFor={id}>{FIELD_LABELS[f].de}</label>
            {kind === "enum" || kind === "boolean" ? (
              <select id={id} value={raw[f] ?? ""} onChange={(e) => set(e.target.value)} aria-invalid={!!errors[f]}>
                <option value="">–</option>
                {(kind === "boolean" ? ["ja", "nein"] : enumOptions(f)).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "number" ? "decimal" : undefined}
                value={raw[f] ?? ""}
                onChange={(e) => set(e.target.value)}
                aria-invalid={!!errors[f]}
              />
            )}
            {errors[f] && <p className="field-error">{errors[f]}</p>}
          </div>
        );
      })}
      {failed && <p className="field-error">{failed}</p>}
      <button className="solid" type="submit" disabled={sending}>
        {sending ? "Sending…" : "Answer"}
      </button>
    </form>
  );
}
