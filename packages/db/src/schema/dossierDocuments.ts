import { pgTable, text, timestamp, integer, uuid, boolean, index } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { dossier_pieces_jointes } from "./dossier_pieces_jointes.js";
import { users } from "./users.js";

/**
 * GED (Gestion Électronique de Documents) du dossier.
 *
 * Coffre des documents **produits par l'instruction** — par opposition à
 * `dossier_pieces_jointes`, qui porte les pièces **déposées par le citoyen**
 * (sémantique CERFA / OCR / RGPD / versioning que l'on ne veut pas polluer).
 *
 * Premier usage (3.D) : l'export aplati d'une pièce annotée par l'instructeur
 * (entourer / commenter). À terme : les courriers PDF générés, autres dépôts
 * internes. Le document de la GED est ensuite **joignable** à un courrier
 * officiel ou à un message interne (cf. `attachments` sur `dossier_courriers`
 * et `dossier_messages`), ce qui laisse l'instructeur libre du canal d'envoi.
 *
 * `shared_with_citizen` est la **garde de confidentialité** : un document de la
 * GED reste invisible du citoyen tant qu'il n'a pas été explicitement joint à
 * un envoi citoyen (message ou courrier). La route `/api/uploads/:key` n'ouvre
 * l'accès citoyen qu'aux documents dont ce drapeau est vrai — sans quoi un
 * brouillon annoté interne fuiterait.
 */
export const dossier_documents = pgTable(
  "dossier_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
    /** Nom affiché du document (ex : "Plan de masse — annoté"). */
    nom: text("nom").notNull(),
    /** URL relative servie par /api/uploads/<key> (même convention que les pièces). */
    url: text("url").notNull(),
    /** Type MIME stocké (ex : "application/pdf", "image/png"). */
    type: text("type").notNull(),
    /** Taille en octets. */
    taille: integer("taille").notNull(),
    /**
     * Catégorie métier du document :
     *  - "annotation" : export aplati d'une pièce annotée par l'instructeur
     *  - "courrier"   : PDF d'un courrier généré (usage futur)
     *  - "autre"      : dépôt interne libre
     */
    category: text("category").notNull().default("annotation"),
    /** Pièce du citoyen dont ce document est dérivé (annotation), si applicable. */
    source_piece_id: uuid("source_piece_id").references(() => dossier_pieces_jointes.id, { onDelete: "set null" }),
    /** Note libre de l'instructeur (contexte, intention). */
    note: text("note"),
    /**
     * Garde de confidentialité. false (défaut) = document interne, invisible du
     * citoyen. Basculé à true lorsqu'il est joint à un message/courrier citoyen.
     */
    shared_with_citizen: boolean("shared_with_citizen").notNull().default(false),
    created_by: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    dossierIdx: index("idx_dossier_documents_dossier").on(t.dossier_id),
    sourcePieceIdx: index("idx_dossier_documents_source_piece").on(t.source_piece_id),
  }),
);

export type DossierDocumentCategory = "annotation" | "courrier" | "autre";
export const DOSSIER_DOCUMENT_CATEGORIES: ReadonlyArray<DossierDocumentCategory> = [
  "annotation", "courrier", "autre",
];

/** Référence d'une pièce jointe GED portée par un courrier ou un message. */
export interface DocumentAttachmentRef {
  document_id: string;
  nom: string;
  url: string;
  type: string;
}
