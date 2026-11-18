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

/** Every value of every number in a text. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(new RegExp(NUM, "g"))].flatMap((m) => values(m[0]));
}
