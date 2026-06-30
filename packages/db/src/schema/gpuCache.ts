import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

// Cache for IGN GPU API responses per parcel.
// GPU API (apicarto.ign.fr) has no SLA and returns 503 regularly.
// When available: fetch → store here. When down: serve stale data with a warning.
// TTL: 30 days (PLU data changes rarely, SUP even more rarely).
export const gpu_parcel_cache = pgTable("gpu_parcel_cache", {
  // Lookup key: parcelle_id ("37214000BC0154") or rounded coords ("47.4032,0.6532")
  cache_key:       text("cache_key").primaryKey(),
  parcelle_id:     text("parcelle_id"),
  // Raw GPU responses (null = endpoint returned no data or was not queried)
  documents:       jsonb("documents"),       // /document → pluPartition + scotName
  zone_urba:       jsonb("zone_urba"),        // /zone-urba → PluZoneResult
  municipality:    jsonb("municipality"),     // /municipality → MunicipalityResult
  prescriptions:   jsonb("prescriptions"),   // /prescription-{surf,lin,pct} → PrescriptionResult[]
  informations:    jsonb("informations"),     // /info-surf → InformationResult[]
  sup_surf:        jsonb("sup_surf"),         // /assiette-sup-s → ServitudeResult[]
  sup_lin:         jsonb("sup_lin"),          // /assiette-sup-l → ServitudeResult[]
  sup_pct:         jsonb("sup_pct"),          // /assiette-sup-p → ServitudeResult[]
  generateurs:     jsonb("generateurs"),      // /generateur-sup-{s,l,p} → enrichment map
  // Meta
  plu_partition:   text("plu_partition"),
  scot_name:       text("scot_name"),
  cached_at:       timestamp("cached_at").notNull().defaultNow(),
  hit_count:       integer("hit_count").notNull().default(0),
});
