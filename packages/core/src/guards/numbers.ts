/** A number as written: digits with optional thousands or decimal separators ("1.450", "1,450", "78,5"). */
export const NUM = String.raw`\d+(?:[.,]\d+)*`;

/**
 * Every value a written number can mean. "1.450" is 1450 in German and 1.45 in English, so both count;
 * "78,5" is 78.5 in German and 785 in English.
 */
export function values(token: string): number[] {
  if (/^\d+$/.test(token)) return [Number(token)];
  const parts = token.split(/[.,]/);
  const seps = token.replace(/\d/g, "");
  if (new Set(seps).size === 2) {
    // Both separators: the last one is the decimal separator.
    const decimal = seps.at(-1)!;
    const other = decimal === "." ? "," : ".";
    return [Number(token.split(other).join("").replace(decimal, "."))];
  }
  const decimal = Number(`${parts.slice(0, -1).join("")}.${parts.at(-1)}`);
  const thousands = parts.slice(1).every((p) => p.length === 3) ? [Number(parts.join(""))] : [];
  return [decimal, ...thousands];
}

export interface InventedNumber {
  /** The number as written, e.g. "65". */
  raw: string;
  /** About 20 characters either side, to show where it is. */
  context: string;
}

/** Numbers that never need a source: "1 Balkon", "0 Stufen". */
const ALWAYS_OK = new Set([0, 1]);

/** Every number in the texts whose possible values are all unknown. */
export function checkNumbers(texts: string[], known: Set<number>): InventedNumber[] {
  const out: InventedNumber[] = [];
  for (const text of texts) {
    for (const m of text.matchAll(new RegExp(NUM, "g"))) {
      const vals = values(m[0]);
      if (vals.some((v) => ALWAYS_OK.has(v) || known.has(v))) continue;
      const i = m.index ?? 0;
      out.push({ raw: m[0], context: text.slice(Math.max(0, i - 20), i + m[0].length + 20).replace(/\s+/g, " ").trim() });
    }
  }
  return out;
}

/** Every value of every number in a text. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(new RegExp(NUM, "g"))].flatMap((m) => values(m[0]));
}
