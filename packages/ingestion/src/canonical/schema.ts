/**
 * Format canonique d'ingestion PLU — HEUREKA Canonical PLU v1.
 *
 * Ce format est la SOURCE DE VÉRITÉ que tout outil tiers (bureau d'études,
 * logiciel métier, éditeur de PLU) peut produire pour pousser un règlement
 * en HEUREKA SANS passer par l'extraction LLM. Bénéfices :
 *
 *  - Coût : zéro token Anthropic consommé sur l'ingestion.
 *  - Certitude juridique : ce que l'instructeur écrit = ce qui est servi.
 *  - Versionnable : le JSON vit dans Git, audit trail natif.
 *  - Échange : un bureau d'études peut livrer le même JSON à plusieurs
 *    communes / éditeurs.
 *
 * Toute évolution non rétro-compatible doit incrémenter `schema_version` et
 * la migration côté loader doit gérer les versions antérieures.
 *
 * Le schéma équivalent JSON Schema (pour les outils externes) est généré
 * depuis ce fichier dans canonical-schema.json — voir scripts/.
 */
import { z } from "zod";

// ── Topics : alignés sur structurer.RULE_TOPICS ──────────────────────────────
// On n'enferme PAS la liste dans un enum strict pour ne pas casser les
// imports quand l'écosystème métier ajoute un thème spécifique (PPRI, PEB…).
// Le loader émet un avertissement sur un topic inconnu mais n'échoue pas.
export const KNOWN_TOPICS = [
  "interdictions", "conditions", "desserte_voies", "desserte_reseaux", "terrain_min",
  "recul_voie", "recul_limite", "recul_batiments", "emprise_sol", "hauteur", "aspect",
  "stationnement", "espaces_verts", "cos", "destinations", "general",
] as const;

// Tags d'applicabilité — voir structurer.ts. Mêmes restrictions de souplesse.
export const KNOWN_APPLIES_IF = [
  "protege_l151_19", "unesco", "abf", "inondable", "extension", "surelevation",
  "ravalement", "demolition", "cloture_sur_rue", "cloture_limite", "annexe",
  "devanture_commerciale", "equipement_public",
] as const;

// ── Cas conditionnel ──────────────────────────────────────────────────────────

export const CanonicalRuleCaseSchema = z.object({
  condition: z.string().min(1, "case.condition ne peut pas être vide"),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  kind: z.enum(["condition", "parametre"]),
});
export type CanonicalRuleCase = z.infer<typeof CanonicalRuleCaseSchema>;

// ── Règle ─────────────────────────────────────────────────────────────────────

export const CanonicalRuleSchema = z.object({
  // Identité dans le règlement
  // Décimal autorisé : les PLU modernisés numérotent en « 12.1 », « 12.2 »…
  article_number: z.number().nullable(),
  article_title: z.string().default(""),
  sub_theme: z.string().nullable().default(null),

  // Classification
  topic: z.string().min(1, "topic requis"),

  // Texte normatif fidèle (la prose EST la règle juridique)
  rule_text: z.string().min(1, "rule_text requis"),

  // Valeur principale chiffrée — au moins un parmi value_min/value_max/value_exact
  // peut être renseigné. Tous null = règle purement qualitative.
  value_min: z.number().nullable().default(null),
  value_max: z.number().nullable().default(null),
  value_exact: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),

  // Mises au point
  conditions: z.string().nullable().default(null),
  exceptions: z.string().nullable().default(null),
  cases: z.array(CanonicalRuleCaseSchema).default([]),
  applies_if: z.array(z.string()).default([]),

  // Vues abrégées
  summary: z.string().default(""),
  instructor_note: z.string().nullable().default(null),

  // Version citoyen (langage courant) — recommandée mais facultative
  citizen_title: z.string().nullable().default(null),
  citizen_summary: z.string().nullable().default(null),
  citizen_relevant: z.boolean().default(true),

  // Traçabilité de la source — facultatif mais fortement encouragé pour
  // pouvoir citer la règle dans une instruction ("PLU Ballan, p. 42").
  source: z
    .object({
      document: z.string().optional(),
      page: z.number().int().positive().optional(),
      paragraph: z.string().optional(),
    })
    .partial()
    .nullable()
    .default(null),
});
export type CanonicalRule = z.infer<typeof CanonicalRuleSchema>;

// ── Zone ──────────────────────────────────────────────────────────────────────

export const CanonicalZoneSchema = z.object({
  code: z.string().min(1, "zone.code requis (ex: UA, 1AU, Nh)"),
  label: z.string().min(1, "zone.label requis"),
  // Catégorie nationale : U = urbaine, AU = à urbaniser, A = agricole, N = naturelle.
  type: z.enum(["U", "AU", "A", "N"]),
  summary: z.string().nullable().default(null),
  rules: z.array(CanonicalRuleSchema).default([]),
});
export type CanonicalZone = z.infer<typeof CanonicalZoneSchema>;

// ── Métadonnées du document ───────────────────────────────────────────────────

export const CanonicalMetaSchema = z.object({
  commune: z.string().min(1, "_meta.commune requis"),
  insee: z
    .string()
    .regex(/^\d[A-B0-9]\d{3}$|^\d{5}$/, "_meta.insee invalide (5 caractères, ex: 37018)"),
  zip_code: z.string().optional(),
  // Version humaine du document (ex: "M5_20180129", "Approuvé_2022")
  doc_version: z.string().min(1, "_meta.doc_version requis"),
  // Dates légales. ISO 8601 (YYYY-MM-DD ou avec heure).
  adopted_at: z.string().optional(),
  effective_from: z.string().optional(),
  effective_to: z.string().optional(),
  source_url: z.string().url().optional(),
  produced_by: z.string().optional(),
  produced_at: z.string().optional(),
  notes: z.string().optional(),
});
export type CanonicalMeta = z.infer<typeof CanonicalMetaSchema>;

// ── Document complet ──────────────────────────────────────────────────────────

export const CANONICAL_SCHEMA_VERSION = 1 as const;

export const CanonicalPLUSchema = z.object({
  schema_version: z.literal(CANONICAL_SCHEMA_VERSION),
  _meta: CanonicalMetaSchema,
  zones: z.array(CanonicalZoneSchema).min(1, "Au moins une zone requise"),
});
export type CanonicalPLU = z.infer<typeof CanonicalPLUSchema>;

// ── Parsing utilitaire ────────────────────────────────────────────────────────

export interface CanonicalParseResult {
  ok: boolean;
  data?: CanonicalPLU;
  /** Messages prêts à afficher à l'instructeur. Chemin JSON inclus. */
  errors?: string[];
  /** Topics ou applies_if non reconnus — non-bloquant. */
  warnings?: string[];
}

export function parseCanonical(input: unknown): CanonicalParseResult {
  const result = CanonicalPLUSchema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((i) => {
        const path = i.path.length ? i.path.join(".") : "<racine>";
        return `${path}: ${i.message}`;
      }),
    };
  }
  const warnings: string[] = [];
  for (const z of result.data.zones) {
    for (const r of z.rules) {
      if (!KNOWN_TOPICS.includes(r.topic as (typeof KNOWN_TOPICS)[number])) {
        warnings.push(`Zone ${z.code} / article ${r.article_number ?? "?"} : topic non standard "${r.topic}"`);
      }
      for (const tag of r.applies_if) {
        if (!KNOWN_APPLIES_IF.includes(tag as (typeof KNOWN_APPLIES_IF)[number])) {
          warnings.push(`Zone ${z.code} : tag applies_if non reconnu "${tag}"`);
        }
      }
    }
  }
  return { ok: true, data: result.data, warnings: warnings.length ? warnings : undefined };
}
