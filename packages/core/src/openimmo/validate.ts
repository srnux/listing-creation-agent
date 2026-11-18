import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { create } from "xmlbuilder2";
import { validateXML } from "xmllint-wasm";

/** The official XSD, if the presenter placed it here (its license forbids redistribution, so it is not committed). */
export const XSD_PATH = fileURLToPath(new URL("../../../../schemas/openimmo_127b.xsd", import.meta.url));

export interface ValidationResult {
  valid: boolean;
  mode: "xsd" | "fallback";
  errors: string[];
}

/** Paths the fallback check requires, in OpenImmo 1.2.7 terms. "a|b" means either element. */
const REQUIRED = [
  "uebertragung",
  "anbieter/openimmo_anid",
  "anbieter/firma",
  "anbieter/immobilie/objektkategorie/nutzungsart",
  "anbieter/immobilie/objektkategorie/vermarktungsart",
  "anbieter/immobilie/objektkategorie/objektart",
  "anbieter/immobilie/geo/ort",
  "anbieter/immobilie/geo/land",
  "anbieter/immobilie/kontaktperson",
  "anbieter/immobilie/preise/kaltmiete",
  "anbieter/immobilie/flaechen/wohnflaeche",
  "anbieter/immobilie/flaechen/anzahl_zimmer",
  "anbieter/immobilie/zustand_angaben/energiepass/epart",
  "anbieter/immobilie/zustand_angaben/energiepass/gueltig_bis",
  "anbieter/immobilie/zustand_angaben/energiepass/energieverbrauchkennwert|endenergiebedarf",
  "anbieter/immobilie/zustand_angaben/energiepass/primaerenergietraeger",
  "anbieter/immobilie/zustand_angaben/energiepass/baujahr",
  "anbieter/immobilie/zustand_angaben/energiepass/wertklasse",
  "anbieter/immobilie/freitexte/objekttitel",
  "anbieter/immobilie/freitexte/objektbeschreibung",
  "anbieter/immobilie/verwaltung_techn/objektnr_extern",
  "anbieter/immobilie/verwaltung_techn/openimmo_obid",
  "anbieter/immobilie/verwaltung_techn/stand_vom",
];

/** Element order inside <immobilie> (the XSD is a sequence). */
const IMMOBILIE_ORDER = ["objektkategorie", "geo", "kontaktperson", "preise", "flaechen", "ausstattung", "zustand_angaben", "freitexte", "anhaenge", "verwaltung_techn"];

type Node = Record<string, unknown>;

const child = (node: unknown, name: string): unknown => {
  if (!node || typeof node !== "object") return undefined;
  const v = (node as Node)[name];
  return Array.isArray(v) ? v[0] : v;
};


function fallbackCheck(xml: string): string[] {
  let root: Node;
  try {
    root = create(xml).end({ format: "object" }) as Node;
  } catch (e) {
    return [`Not well-formed XML: ${e instanceof Error ? e.message : String(e)}`];
  }
  const openimmo = root.openimmo;
  if (!openimmo || typeof openimmo !== "object") return ["Root element must be <openimmo>."];
  const errors: string[] = [];
  for (const path of REQUIRED) {
    const parts = path.split("/");
    const last = parts.pop()!;
    let node: unknown = openimmo;
    for (const p of parts) node = child(node, p);
    const ok = last.split("|").some((name) => {
      const v = child(node, name);
      // Elements with only attributes (<land iso_land=…/>, <aktion/>) count as present.
      return v !== undefined && (typeof v !== "string" || v.trim() !== "");
    });
    if (!ok) errors.push(`Missing or empty: ${path.replace(/\|/g, " or ")}`);
  }
  const immo = child(child(openimmo, "anbieter"), "immobilie");
  if (immo && typeof immo === "object") {
    const present = Object.keys(immo).filter((k) => IMMOBILIE_ORDER.includes(k));
    const expected = IMMOBILIE_ORDER.filter((k) => present.includes(k));
    if (present.join() !== expected.join()) errors.push(`Elements inside <immobilie> are out of order: ${present.join(", ")}`);
  }
  return errors;
}

/** Validates against the official XSD when present, else a structural check of the required elements. */
export async function validateOpenImmo(xml: string, xsdPath = XSD_PATH): Promise<ValidationResult> {
  if (existsSync(xsdPath)) {
    const res = await validateXML({
      xml: { fileName: "openimmo.xml", contents: xml },
      schema: { fileName: "openimmo.xsd", contents: readFileSync(xsdPath, "utf8") },
    });
    return { valid: res.valid, mode: "xsd", errors: res.errors.map((e) => e.rawMessage) };
  }
  const errors = fallbackCheck(xml);
  return { valid: errors.length === 0, mode: "fallback", errors };
}

