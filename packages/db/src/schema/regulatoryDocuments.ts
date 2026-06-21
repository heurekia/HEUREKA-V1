import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Documents réglementaires rattachés à une commune OU à un EPCI (cas PLUi).
// Renommé depuis commune_documents au Lot 1b : la table n'est plus strictement
// « par commune » dès lors qu'un PLUi peut être porté par un groupement et
// couvrir N communes membres via document_communes.
export const regulatory_documents = pgTable("regulatory_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Commune « propriétaire » historique. Nullable depuis le support PLUi : un
  // document porté par un EPCI (porteur_epci_id) n'a pas de commune unique —
  // son périmètre vit dans document_communes. Les documents communaux gardent
  // commune_id renseigné (= porteur_commune_id). Le porteur effectif est
  // toujours donné par le couple porteur_commune_id / porteur_epci_id (XOR).
  commune_id: uuid("commune_id"),
  // Porteur du document. Exactement l'un des deux est renseigné (CHECK SQL).
  // Permet de rattacher un PLUi à un EPCI tout en gardant la commune comme
  // porteur par défaut des documents communaux historiques.
  porteur_commune_id: uuid("porteur_commune_id"),
  porteur_epci_id: uuid("porteur_epci_id"),
  type: text("type").notNull(), // cf. REGULATORY_DOCUMENT_TYPES ci-dessous
  name: text("name").notNull(),
  original_filename: text("original_filename").notNull(),
  file_size: integer("file_size"),
  pdf_content: text("pdf_content"), // base64 — conservé pour l'ingestion IA (Phase 2)
  // Synthèse textuelle (rédigée par l'instructeur) sur laquelle l'outil s'appuie
  // pendant l'instruction des dossiers situés dans le périmètre concerné.
  // ⚠️ Ne sera lue par le moteur d'instruction QUE si validation_status = 'valide'.
  synthese: text("synthese"),
  status: text("status").notNull().default("uploaded"), // uploaded | ingested | error
  ingested_at: timestamp("ingested_at"),
  // Validation humaine de la synthèse — gate juridique avant injection LLM.
  // Convention alignée avec zone_regulatory_rules : valide | brouillon | rejete.
  validation_status: text("validation_status").notNull().default("brouillon"),
  validated_by: uuid("validated_by"),
  validated_at: timestamp("validated_at"),
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});

// Vocabulaire des types de documents réglementaires. Texte libre en base (la
// colonne reste `text` pour ne pas figer le référentiel — cf. décision produit
// « type ouvert »), mais ces constantes servent de référence partagée à
// l'ingestion, à l'UI et aux validations.
//
//  - plu  : Plan Local d'Urbanisme communal (porteur = commune).
//  - plui : PLU intercommunal (porteur = EPCI, rattaché à N communes).
//  - plum : PLU métropolitain — variante de PLUi portée par une métropole.
//  - ppri/pprt : plans de prévention des risques (inondation / technologique).
//  - oap  : Orientations d'Aménagement et de Programmation.
//  - peb  : Plan d'Exposition au Bruit.
//  - plh  : Programme Local de l'Habitat.
//  - zac  : Zone d'Aménagement Concerté.
//  - autre: tout document non catalogué (ingestion possible, à qualifier).
export const REGULATORY_DOCUMENT_TYPES = [
  "plu",
  "plui",
  "plum",
  "ppri",
  "pprt",
  "oap",
  "peb",
  "plh",
  "zac",
  "autre",
] as const;
export type RegulatoryDocumentType = (typeof REGULATORY_DOCUMENT_TYPES)[number];

// « Famille PLU » : les types qui produisent un zonage + des règles
// structurées (zones / zone_regulatory_rules). C'est ce sous-ensemble qui
// distingue un document « réglementaire de zonage » (PLU/PLUi/PLUm) d'une
// annexe thématique (PPRI, OAP…). Sert au backfill des règles et à la
// détection du mode réglementaire d'un EPCI.
export const PLU_FAMILY_TYPES = ["plu", "plui", "plum"] as const;
export type PluFamilyType = (typeof PLU_FAMILY_TYPES)[number];

export function isPluFamily(type: string | null | undefined): boolean {
  return type != null && (PLU_FAMILY_TYPES as readonly string[]).includes(type);
}
