import { z } from "zod";

/**
 * Every fact the listing can hold, with its schema. Browser-safe (zod only): the question form uses the same
 * schemas and labels. The list of required fields is code, not prompt.
 */

export const ORIENTATIONS = ["north", "east", "south", "west", "south-west", "south-east", "north-west", "north-east"] as const;
export const ENERGY_CERTIFICATE_TYPES = ["bedarf", "verbrauch"] as const;
export const ENERGY_CARRIERS = ["gas", "oel", "fernwaerme", "strom", "waermepumpe", "holz", "solar"] as const;
export const ENERGY_CLASSES = ["A+", "A", "B", "C", "D", "E", "F", "G", "H"] as const;

const year = z.number().int().min(1800).max(2100);

export const FIELD_SCHEMAS = {
  rooms: z.number().positive().multipleOf(0.5),
  floor: z.number().int().min(-1).max(60),
  living_area_m2: z.number().positive().max(2000),
  price_cold_eur: z.number().positive(),
  service_charges_eur: z.number().nonnegative(),
  kitchen_year: year,
  built_in_kitchen: z.boolean(),
  balcony: z.boolean(),
  balcony_orientation: z.enum(ORIENTATIONS),
  city: z.string().trim().min(1),
  district: z.string().trim().min(1),
  street: z.string().trim().min(1),
  postal_code: z.string().regex(/^\d{5}$/),
  location_facts: z.array(z.string().trim().min(1)).min(1),
  available_from: z.string().trim().min(1),
  energy_certificate_type: z.enum(ENERGY_CERTIFICATE_TYPES),
  energy_value_kwh: z.number().positive().max(1000),
  energy_carrier: z.enum(ENERGY_CARRIERS),
  energy_construction_year: year,
  energy_class: z.enum(ENERGY_CLASSES),
  energy_valid_until: z.iso.date(),
} as const;

export type FieldId = keyof typeof FIELD_SCHEMAS;
export const FIELD_IDS = Object.keys(FIELD_SCHEMAS) as FieldId[];
export const isFieldId = (s: string): s is FieldId => s in FIELD_SCHEMAS;

export const FIELD_LABELS: Record<FieldId, { de: string; en: string }> = {
  rooms: { de: "Zimmer", en: "Rooms" },
  floor: { de: "Etage", en: "Floor" },
  living_area_m2: { de: "Wohnfläche (m²)", en: "Living area (m²)" },
  price_cold_eur: { de: "Kaltmiete (€)", en: "Rent excl. utilities (€)" },
  service_charges_eur: { de: "Nebenkosten (€)", en: "Service charges (€)" },
  kitchen_year: { de: "Baujahr Küche", en: "Kitchen year" },
  built_in_kitchen: { de: "Einbauküche", en: "Built-in kitchen" },
  balcony: { de: "Balkon", en: "Balcony" },
  balcony_orientation: { de: "Balkon-Ausrichtung", en: "Balcony orientation" },
  city: { de: "Stadt", en: "City" },
  district: { de: "Stadtteil", en: "District" },
  street: { de: "Straße und Hausnummer", en: "Street and number" },
  postal_code: { de: "PLZ", en: "Postal code" },
  location_facts: { de: "Lage-Fakten", en: "Location facts" },
  available_from: { de: "Frei ab", en: "Available from" },
  energy_certificate_type: { de: "Energieausweis-Art", en: "Energy certificate type" },
  energy_value_kwh: { de: "Energiekennwert (kWh/m²a)", en: "Energy value (kWh/m²a)" },
  energy_carrier: { de: "Wesentlicher Energieträger", en: "Main energy carrier" },
  energy_construction_year: { de: "Baujahr laut Energieausweis", en: "Construction year (certificate)" },
  energy_class: { de: "Energieeffizienzklasse", en: "Energy efficiency class" },
  energy_valid_until: { de: "Energieausweis gültig bis", en: "Certificate valid until" },
};

/** What an ad must state. GEG §87 makes the energy certificate data mandatory in property ads. */
export const REQUIRED_FIELDS: FieldId[] = [
  "price_cold_eur",
  "living_area_m2",
  "rooms",
  "floor",
  "city",
  "district",
  "energy_certificate_type",
  "energy_value_kwh",
  "energy_carrier",
  "energy_construction_year",
  "energy_class",
  "energy_valid_until",
];
