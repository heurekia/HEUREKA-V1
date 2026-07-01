import { integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  // Couche vectorielle (GeoJSON FeatureCollection) pour les annexes SPATIALES —
  // ex. le « plan des hauteurs » (type plan_hauteurs) : polygones portant la
  // hauteur maximale. Isolé du zonage PLU (table zones) pour ne PAS polluer la
  // résolution de zone. Lu par le résolveur de hauteur (heightLayer.ts). null
  // pour les documents purement textuels (PLU, PPRI…).
  geojson: jsonb("geojson"),
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
  // Fenêtre d'entrée en vigueur (Lot 5 — datation d'effet, patron aligné sur
  // commune_fiscalite). Sert à ARBITRER la substitution entre documents de la
  // MÊME famille PLU couvrant une même commune : un PLUi entré en vigueur
  // remplace le PLU communal historique. Le résolveur ne retient, par commune
  // et pour la famille PLU, que le document en vigueur à la date d'analyse :
  //   effective_from IS NULL OR effective_from <= D   (NULL = « depuis toujours »)
  //   AND (effective_to IS NULL OR effective_to > D)  (NULL = toujours en vigueur)
  // Les deux NULL par défaut → rétro-compat : tout document existant reste
  // « en vigueur, sans borne ». Les autres familles (PPRI, OAP…) ne sont pas
  // concernées : elles se SUPERPOSENT, jamais ne se substituent.
  effective_from: timestamp("effective_from"),
  effective_to: timestamp("effective_to"),
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
  // plan_hauteurs : annexe graphique « plan des hauteurs » du PLU, déposée comme
  // couche vectorielle (geojson) — polygones portant la hauteur maximale. Sert à
  // compléter la règle de hauteur et la constructibilité quand le règlement
  // écrit renvoie au document graphique (ex. Tours).
  "plan_hauteurs",
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
