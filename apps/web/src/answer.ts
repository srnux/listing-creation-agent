import { FIELD_SCHEMAS, type FieldId } from "@listing/core/fields";

export type FieldKind = "number" | "boolean" | "enum" | "list" | "date" | "text";

export function fieldKind(field: FieldId): FieldKind {
  if (field === "energy_valid_until" || field === "available_from") return "date";
  const t = (FIELD_SCHEMAS[field] as { def: { type: string } }).def.type;
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  if (t === "enum") return "enum";
  if (t === "array") return "list";
  return "text";
}

export const enumOptions = (field: FieldId): string[] => (FIELD_SCHEMAS[field] as unknown as { options?: string[] }).options ?? [];

/** "1.450" → 1450, "112,5" → 112.5, "82.5" → 82.5; anything else → NaN. */
export function parseNumber(raw: string): number {
  const t = raw.trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(",", "."));
  return Number.NaN;
}

/** Turns the form's text inputs into a typed answer; any error means no answer. */
export function parseAnswer(fields: FieldId[], raw: Partial<Record<string, string>>): { answer?: Partial<Record<FieldId, unknown>>; errors: Partial<Record<FieldId, string>> } {
  const answer: Partial<Record<FieldId, unknown>> = {};
  const errors: Partial<Record<FieldId, string>> = {};
  for (const f of fields) {
    const text = (raw[f] ?? "").trim();
    if (!text) {
      errors[f] = "Pflichtfeld";
      continue;
    }
    let value: unknown = text;
    const kind = fieldKind(f);
    if (kind === "number") {
      value = parseNumber(text);
      if (Number.isNaN(value)) {
        errors[f] = "Bitte eine Zahl eingeben";
        continue;
      }
    } else if (kind === "boolean") value = /^(ja|true|yes)$/i.test(text);
    else if (kind === "list") value = text.split(";").map((s) => s.trim()).filter(Boolean);
    const parsed = FIELD_SCHEMAS[f].safeParse(value);
    if (!parsed.success) {
      errors[f] = parsed.error.issues[0]?.message ?? "Ungültig";
      continue;
    }
    answer[f] = parsed.data;
  }
  return Object.keys(errors).length ? { errors } : { answer, errors };
}
