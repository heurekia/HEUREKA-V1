/**
 * Barrel pour l'import canonique — consommable depuis @heureka-v1/api sans
 * déclencher le CLI principal de @heureka-v1/ingestion.
 */
export {
  CanonicalPLUSchema,
  CanonicalZoneSchema,
  CanonicalRuleSchema,
  CanonicalRuleCaseSchema,
  CanonicalMetaSchema,
  CANONICAL_SCHEMA_VERSION,
  KNOWN_TOPICS,
  KNOWN_APPLIES_IF,
  parseCanonical,
} from "./schema.ts";
export type {
  CanonicalPLU,
  CanonicalZone,
  CanonicalRule,
  CanonicalRuleCase,
  CanonicalMeta,
  CanonicalParseResult,
} from "./schema.ts";

export { canonicalToZoneRules, importCanonical } from "./loader.ts";
export type { ImportCanonicalResult } from "./loader.ts";
