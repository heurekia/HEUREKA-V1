// Légifrance — static mapping data for legal mentions in courriers.
// Article content is pre-seeded in the DB (legal_mentions table) via migrate.ts.

export const CODE_URBANISME_ID   = "LEGITEXT000006074075";
export const CODE_URBANISME_NAME = "Code de l'urbanisme";

// Suggestion mapping: "{type_dossier}:{category}" or "*:{category}" → article refs
export const MENTIONS_MAP: Record<string, string[]> = {
  // Permis de construire
  "permis_de_construire:avis_favorable":         ["L424-1", "L462-1", "R462-1", "R462-3"],
  "permis_de_construire:avis_defavorable":        ["L424-3", "L600-2", "R424-2", "R424-3"],
  "permis_de_construire:avis_reserves":           ["L424-1", "L462-4", "R462-1"],
  "permis_de_construire:accord_tacite":           ["L424-2", "R423-26", "R423-43"],
  "permis_de_construire:pieces_complementaires":  ["R423-38", "R423-39", "R423-40"],
  "permis_de_construire:notification_decision":   ["L424-6", "R424-1", "R424-5"],
  // Déclaration préalable
  "declaration_prealable:avis_favorable":         ["L424-1", "L462-1"],
  "declaration_prealable:avis_defavorable":       ["L424-3", "L600-2", "R424-2"],
  "declaration_prealable:avis_reserves":          ["L424-1", "R424-1"],
  "declaration_prealable:accord_tacite":          ["L424-2", "R423-26"],
  "declaration_prealable:pieces_complementaires": ["R423-38", "R423-39"],
  "declaration_prealable:notification_decision":  ["L424-6", "R424-5"],
  // Permis d'aménager
  "permis_amenager:avis_favorable":               ["L424-1", "L462-1"],
  "permis_amenager:avis_defavorable":             ["L424-3", "R424-2"],
  "permis_amenager:accord_tacite":                ["L424-2"],
  "permis_amenager:pieces_complementaires":       ["R423-38", "R423-39"],
  // Permis de démolir
  "permis_demolir:avis_favorable":                ["L424-1"],
  "permis_demolir:avis_defavorable":              ["L424-3", "R424-2"],
  "permis_demolir:pieces_complementaires":        ["R423-38"],
  // Certificat d'urbanisme
  "certificat_urbanisme:notification_decision":   ["L410-1", "L410-2"],
  // Wildcards
  "*:accord_tacite":                              ["L424-2"],
  "*:pieces_complementaires":                     ["R423-38", "R423-39", "R423-40"],
  "*:avis_defavorable":                           ["L424-3", "L600-2"],
  "*:notification_decision":                      ["L424-6", "R424-5"],
};
