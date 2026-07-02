import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Référentiel PARAMÉTRABLE des types de documents réglementaires — pilote les
// listes déroulantes « Type » du formulaire de dépôt (côté mairie, cf.
// ParametresScreen, et côté super-admin pour les documents portés par un EPCI).
//
// Historiquement, ces intitulés étaient codés en dur dans le front (DOC_TYPES /
// EPCI_DOCUMENT_TYPES). Cette table permet au super-admin d'éditer les libellés,
// couleurs, ordre et visibilité sans redéploiement. La colonne `value` reste la
// clé stockée dans regulatory_documents.type (référentiel « type ouvert » — cf.
// REGULATORY_DOCUMENT_TYPES), et n'est donc jamais renommée : on ajoute /
// désactive des entrées, on renomme uniquement le `label` affiché.
export const regulatory_document_types = pgTable("regulatory_document_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Clé technique persistée dans regulatory_documents.type. Slug stable
  // (^[a-z0-9_]+$). Unique — sert de charnière entre l'affichage et la donnée.
  value: text("value").notNull().unique(),
  // Intitulé court affiché dans la liste déroulante et sur les badges (ex. "PLU").
  label: text("label").notNull(),
  // Complément descriptif optionnel (ex. "Plan local d'urbanisme communal").
  // Affiché après le libellé dans la liste EPCI ("PLU — Plan local…").
  description: text("description"),
  // Couleur du badge de regroupement dans la liste des documents (hex).
  color: text("color").notNull().default("#64748B"),
  // Où l'entrée apparaît : 'commune' (dépôt mairie), 'epci' (dépôt super-admin
  // EPCI) ou 'both'. Préserve le comportement historique (un PLU communal ne se
  // dépose pas depuis un EPCI, un PLUi ne se dépose pas depuis une commune).
  scope: text("scope").notNull().default("both"), // commune | epci | both
  sort_order: integer("sort_order").notNull().default(0),
  // Une entrée désactivée disparaît des listes déroulantes mais reste connue
  // (les documents déjà déposés avec ce type continuent de s'afficher).
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

export type RegulatoryDocumentTypeRow = typeof regulatory_document_types.$inferSelect;
export type RegulatoryDocumentTypeScope = "commune" | "epci" | "both";

// Jeu par défaut, aligné sur les anciennes constantes front (DOC_TYPES côté
// mairie + EPCI_DOCUMENT_TYPES côté super-admin). Sert au seed initial de la
// table (migrate.ts). Les `sort_order` reproduisent l'ordre historique de
// chaque liste (plui/plum en tête côté EPCI, plu en tête côté commune).
export const DEFAULT_REGULATORY_DOCUMENT_TYPES: {
  value: string;
  label: string;
  description: string | null;
  color: string;
  scope: RegulatoryDocumentTypeScope;
  sort_order: number;
}[] = [
  { value: "plui", label: "PLUi", description: "Plan local d'urbanisme intercommunal", color: "#1E40AF", scope: "epci", sort_order: 5 },
  { value: "plum", label: "PLUm", description: "Plan local d'urbanisme métropolitain", color: "#1E40AF", scope: "epci", sort_order: 6 },
  { value: "plu", label: "PLU", description: "Plan local d'urbanisme communal", color: "#1E40AF", scope: "commune", sort_order: 10 },
  { value: "ppri", label: "PPRI", description: "Plan de prévention des risques d'inondation", color: "#EF4444", scope: "both", sort_order: 20 },
  { value: "oap", label: "OAP", description: "Orientation d'aménagement et de programmation", color: "#8B5CF6", scope: "both", sort_order: 30 },
  { value: "peb", label: "PEB", description: "Plan d'exposition au bruit", color: "#F59E0B", scope: "both", sort_order: 40 },
  { value: "pprt", label: "PPRT", description: "Plan de prévention des risques technologiques", color: "#EC4899", scope: "both", sort_order: 50 },
  { value: "plh", label: "PLH", description: "Programme local de l'habitat", color: "#10B981", scope: "both", sort_order: 60 },
  { value: "zac", label: "ZAC", description: "Zone d'aménagement concerté", color: "#3B82F6", scope: "both", sort_order: 70 },
  { value: "plan_hauteurs", label: "Plan des hauteurs", description: "Annexe graphique des hauteurs du PLU", color: "#0EA5E9", scope: "commune", sort_order: 100 },
  { value: "autre", label: "Autre", description: "Autre document réglementaire", color: "#64748B", scope: "both", sort_order: 110 },
];
