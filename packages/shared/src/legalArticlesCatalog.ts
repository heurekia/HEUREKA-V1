// Catalogue des catégories d'articles juridiques et liste curatée des articles
// par défaut. Sert à la fois au seed (script) et à l'UI admin (filtres, chips).
//
// Ajouter un article : ajouter une entrée dans CURATED_ARTICLES.
// Ajouter une catégorie : ajouter une entrée dans CATEGORIES et utiliser
// son `id` dans CURATED_ARTICLES.

export type CategoryDef = {
  id: string;
  label: string;
  description: string;
};

export const CATEGORIES: CategoryDef[] = [
  { id: "procedure",                label: "Procédure",                description: "Type d'autorisation (DP, PC, PCMI, PA, CU)" },
  { id: "architecte",               label: "Architecte",               description: "Recours obligatoire à un architecte" },
  { id: "demolition",               label: "Démolition",               description: "Permis de démolir et travaux assimilés" },
  { id: "lotissement",              label: "Lotissement",              description: "Division foncière et aménagement d'ensemble" },
  { id: "changement_destination",   label: "Changement de destination", description: "Modification de l'usage d'un local" },
  { id: "abf",                      label: "ABF / Zones protégées",    description: "Abords monuments historiques, sites classés" },
  { id: "delais_recours",           label: "Délais et recours",        description: "Délais d'instruction, recours des tiers" },
  { id: "pieces_dossier",           label: "Pièces du dossier",        description: "Composition du dossier de demande" },
  { id: "performance_energetique",  label: "Performance énergétique",  description: "RE2020, RT existant, CCH" },
  { id: "risques",                  label: "Risques",                  description: "PPRN, PPRI, sites pollués (Code de l'environnement)" },
];

export type CuratedArticle = {
  code: "CU" | "CCH" | "CE";
  num: string;
  categories: string[]; // CategoryDef.id
  // Types de courrier où l'article est pertinent. Sert au tagging
  // legal_mentions.courrier_types côté DB, qui pilote la suggestion auto
  // dans le CourrierModal. Aligné sur COURRIER_TYPES côté UI :
  // "pieces_complementaires", "refus", "non_opposition", "majoration_delai",
  // "daact", "sursis", "notification".
  courrier_types?: string[];
};

// Liste curatée — pas exhaustive, axée sur ce qui apparaît dans le tunnel
// citoyen et dans les courriers d'instruction les plus fréquents.
export const CURATED_ARTICLES: CuratedArticle[] = [
  // ── Procédure (régime des autorisations) ────────────────────────────────────
  { code: "CU", num: "L410-1",  categories: ["procedure"] },                    // Certificat d'urbanisme
  { code: "CU", num: "L421-1",  categories: ["procedure"] },                    // PC : régime général
  { code: "CU", num: "L421-2",  categories: ["procedure"] },                    // PA : régime général
  { code: "CU", num: "L421-3",  categories: ["procedure", "demolition"] },      // PD : régime général
  { code: "CU", num: "L421-4",  categories: ["procedure"] },                    // DP : régime général
  { code: "CU", num: "R421-1",  categories: ["procedure"] },                    // PC obligatoire (construction nouvelle)
  { code: "CU", num: "R421-9",  categories: ["procedure"] },                    // DP : extensions de bâtiment
  { code: "CU", num: "R421-12", categories: ["procedure"] },                    // DP : clôtures et ravalements
  { code: "CU", num: "R421-13", categories: ["procedure"] },                    // DP en zone urbaine
  { code: "CU", num: "R421-14", categories: ["procedure"] },                    // PC : extensions > 20/40 m²
  { code: "CU", num: "R421-17", categories: ["procedure", "changement_destination"] }, // DP changement destination
  { code: "CU", num: "R421-19", categories: ["procedure", "lotissement"] },     // PA : opérations soumises
  { code: "CU", num: "R421-23", categories: ["procedure"] },                    // DP : travaux d'aménagement
  { code: "CU", num: "R421-27", categories: ["procedure", "demolition"] },      // PD obligatoire
  { code: "CU", num: "R421-28", categories: ["procedure", "demolition"] },      // PD : cas particuliers

  // ── Architecte ──────────────────────────────────────────────────────────────
  { code: "CU", num: "L431-1", categories: ["architecte"] },                    // Principe du recours obligatoire
  { code: "CU", num: "L431-3", categories: ["architecte"] },                    // Dérogations (personnes physiques < seuil)
  { code: "CU", num: "R431-2", categories: ["architecte"] },                    // Seuil 150 m² surface plancher

  // ── Lotissement ─────────────────────────────────────────────────────────────
  { code: "CU", num: "L442-1", categories: ["lotissement"] },                   // Définition du lotissement
  { code: "CU", num: "R442-1", categories: ["lotissement", "procedure"] },      // PA en lotissement : procédure

  // ── Changement de destination ───────────────────────────────────────────────
  { code: "CU", num: "R151-27", categories: ["changement_destination"] },       // Liste des destinations PLU
  { code: "CU", num: "R151-28", categories: ["changement_destination"] },       // Sous-destinations PLU

  // ── ABF / Zones protégées ──────────────────────────────────────────────────
  { code: "CU", num: "R425-1",  categories: ["abf"] },                          // Consultations obligatoires
  { code: "CU", num: "R425-15", categories: ["abf"] },                          // Avis ABF (abords MH)

  // ── Délais et recours ──────────────────────────────────────────────────────
  { code: "CU", num: "R423-23", categories: ["delais_recours"] },               // Délais d'instruction de droit commun
  { code: "CU", num: "R423-32", categories: ["delais_recours", "abf"] },        // Majoration de délai (avis ABF, etc.)
  // R.423-38 — notification du caractère incomplet du dossier dans le mois
  // qui suit le dépôt. C'est l'article-clé à citer dans une demande de
  // pièces complémentaires : il fonde juridiquement l'envoi et suspend
  // formellement le délai d'instruction.
  { code: "CU", num: "R423-38", categories: ["pieces_dossier", "delais_recours"], courrier_types: ["pieces_complementaires"] },
  // R.423-39 — délai de 3 mois laissé au pétitionnaire pour compléter,
  // sous peine de rejet tacite.
  { code: "CU", num: "R423-39", categories: ["pieces_dossier", "delais_recours"], courrier_types: ["pieces_complementaires"] },
  { code: "CU", num: "R600-1",  categories: ["delais_recours"] },               // Notification du recours
  { code: "CU", num: "R600-2",  categories: ["delais_recours"] },               // Délai de recours des tiers

  // ── Pièces du dossier ──────────────────────────────────────────────────────
  // Articles à citer dans une demande de pièces complémentaires — chacun
  // fixe la composition du dossier pour son type d'autorisation. Le filtrage
  // serveur (legal_mentions.courrier_types) les remontera en "suggéré".
  { code: "CU", num: "R431-5",  categories: ["pieces_dossier"], courrier_types: ["pieces_complementaires"] }, // PC : pièces communes
  { code: "CU", num: "R431-7",  categories: ["pieces_dossier"], courrier_types: ["pieces_complementaires"] }, // PC : plans
  { code: "CU", num: "R441-1",  categories: ["pieces_dossier"], courrier_types: ["pieces_complementaires"] }, // PA : pièces

  // ── Performance énergétique (CCH) ──────────────────────────────────────────
  { code: "CCH", num: "L171-1", categories: ["performance_energetique"] },      // Performance énergétique : champ
  { code: "CCH", num: "R172-4", categories: ["performance_energetique"] },      // Réglementation énergétique

  // ── Risques (CE) ───────────────────────────────────────────────────────────
  { code: "CE",  num: "L562-1", categories: ["risques"] },                      // PPRN : régime
  { code: "CE",  num: "L562-2", categories: ["risques"] },                      // PPRN : effets
];
