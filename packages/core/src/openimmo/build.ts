import { create } from "xmlbuilder2";
import type { ListingDraft } from "../domain/draft.js";

export interface OpenImmoOptions {
  anbieterId: string;
  objektId: string;
  /** Photo id → path or URL the portal can fetch. Photos without an entry are left out. */
  photoFiles: Record<string, string>;
  /** Defaults to today. */
  date?: string;
}

const CARRIER: Record<string, string> = {
  gas: "GAS",
  oel: "OEL",
  fernwaerme: "FERN",
  strom: "STROM",
  waermepumpe: "UMWELT",
  holz: "HOLZ",
  solar: "SOLAR",
};

const has = (draft: ListingDraft, feature: string) =>
  draft.photos?.photos.some((p) => p.features.some((f) => f.toLowerCase().includes(feature))) ||
  draft.notes.toLowerCase().includes(feature);

/** OpenImmo 1.2.7 for one rental flat. The German exposé is the portal text; poor photos are left out. */
export function buildOpenImmo(draft: ListingDraft, opts: OpenImmoOptions): string {
  const v = <T = string>(f: Parameters<ListingDraft["value"]>[0]) => draft.value<T>(f);
  const de = draft.expose?.de;
  const date = opts.date ?? new Date().toISOString().slice(0, 10);
  const street = v("street") ?? "";
  const m = /^(.*?)\s+(\d+\s*\w?)$/.exec(street);

  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("openimmo");
  doc.ele("uebertragung", { art: "OFFLINE", umfang: "TEIL", modus: "NEW", version: "1.2.7", sendersoftware: "listing-creation-agent", senderversion: "0.1", techn_email: "", timestamp: `${date}T00:00:00` });
  const anbieter = doc.ele("anbieter");
  anbieter.ele("openimmo_anid").txt(opts.anbieterId);
  anbieter.ele("firma").txt("Lindenhof Immobilien");

  const immo = anbieter.ele("immobilie");
  const kat = immo.ele("objektkategorie");
  kat.ele("nutzungsart", { WOHNEN: "true", GEWERBE: "false", ANLAGE: "false", WAZ: "false" });
  kat.ele("vermarktungsart", { KAUF: "false", MIETE_PACHT: "true" });
  kat.ele("objektart").ele("wohnung", { wohnungtyp: "ETAGE" });

  const geo = immo.ele("geo");
  if (v("postal_code")) geo.ele("plz").txt(v("postal_code")!);
  geo.ele("ort").txt(v("city") ?? "");
  if (m) {
    geo.ele("strasse").txt(m[1]!);
    geo.ele("hausnummer").txt(m[2]!);
  } else if (street) geo.ele("strasse").txt(street);
  geo.ele("land", { iso_land: "DEU" });
  if (v("district")) geo.ele("regionaler_zusatz").txt(v("district")!);
  if (v<number>("floor") !== undefined) geo.ele("etage").txt(String(v<number>("floor")));

  const kontakt = immo.ele("kontaktperson");
  kontakt.ele("email_zentrale").txt("vermietung@lindenhof-immobilien.example");
  kontakt.ele("name").txt("Vermietung");
  kontakt.ele("firma").txt("Lindenhof Immobilien");

  const preise = immo.ele("preise");
  preise.ele("kaltmiete").txt(String(v<number>("price_cold_eur") ?? ""));
  if (v<number>("service_charges_eur") !== undefined) preise.ele("nebenkosten").txt(String(v<number>("service_charges_eur")));
  preise.ele("waehrung", { iso_waehrung: "EUR" });

  const fl = immo.ele("flaechen");
  fl.ele("wohnflaeche").txt(String(v<number>("living_area_m2") ?? ""));
  fl.ele("anzahl_zimmer").txt(String(v<number>("rooms") ?? ""));
  if (v<boolean>("balcony")) fl.ele("anzahl_balkone").txt("1");

  const aus = immo.ele("ausstattung");
  if (has(draft, "parkett") || has(draft, "parquet")) aus.ele("boden", { PARKETT: "true" });
  if (v<boolean>("built_in_kitchen")) aus.ele("kueche", { EBK: "true" });
  if (has(draft, "wanne") || has(draft, "bathtub")) aus.ele("bad", { WANNE: "true" });
  if (v<boolean>("balcony")) aus.ele("balkon_terrasse", { BALKON: "true" });

  const zustand = immo.ele("zustand_angaben");
  if (v("energy_certificate_type")) {
    const ep = zustand.ele("energiepass");
    ep.ele("epart").txt(v<string>("energy_certificate_type")!.toUpperCase());
    ep.ele("gueltig_bis").txt(v("energy_valid_until") ?? "");
    const value = String(v<number>("energy_value_kwh") ?? "");
    if (v("energy_certificate_type") === "verbrauch") ep.ele("energieverbrauchkennwert").txt(value);
    else ep.ele("endenergiebedarf").txt(value);
    ep.ele("primaerenergietraeger").txt(CARRIER[v<string>("energy_carrier") ?? ""] ?? "");
    ep.ele("baujahr").txt(String(v<number>("energy_construction_year") ?? ""));
    ep.ele("wertklasse").txt(v("energy_class") ?? "");
  }

  const ft = immo.ele("freitexte");
  ft.ele("objekttitel").txt(de?.title ?? "");
  ft.ele("lage").txt(de?.location ?? "");
  ft.ele("ausstatt_beschr").txt(de?.features.join(", ") ?? "");
  ft.ele("objektbeschreibung").txt(de?.description ?? "");

  const photos = draft.photos;
  if (photos) {
    const anh = immo.ele("anhaenge");
    const poor = new Set(photos.photos.filter((p) => p.quality === "poor").map((p) => p.id));
    for (const id of photos.order) {
      const path = opts.photoFiles[id];
      if (!path || poor.has(id)) continue;
      const a = anh.ele("anhang", { location: "EXTERN", gruppe: id === photos.coverId ? "TITELBILD" : "BILD" });
      a.ele("anhangtitel").txt(photos.photos.find((p) => p.id === id)?.room ?? "");
      a.ele("format").txt("jpg");
      a.ele("daten").ele("pfad").txt(path);
    }
  }

  const vt = immo.ele("verwaltung_techn");
  vt.ele("objektnr_extern").txt(opts.objektId);
  vt.ele("aktion");
  vt.ele("openimmo_obid").txt(`${opts.anbieterId}${opts.objektId}`.replace(/[^A-Z0-9]/gi, "").padEnd(16, "0"));
  vt.ele("stand_vom").txt(date);

  return doc.end({ prettyPrint: true });
}
