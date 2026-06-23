import { pgTable, text, timestamp, uuid, jsonb, integer, index } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { dossier_pieces_jointes } from "./dossier_pieces_jointes.js";
import { users } from "./users.js";

/**
 * Calque d'annotation vectorielle posé par l'instructeur sur une **pièce du
 * citoyen** (`dossier_pieces_jointes`) — la brique qui internalise le travail
 * fait jusqu'ici sous Inkscape / Foxit (entourer, flécher, commenter un plan).
 *
 * À ne pas confondre avec `document_segment_annotations`, qui annote les
 * **documents réglementaires (PLU)** et alimente le RAG/IA. Ici la cible est la
 * pièce d'un dossier et la finalité est la **communication avec le citoyen**.
 *
 * Une ligne = **une marque** (forme + commentaire optionnel + visibilité), ce
 * qui permet une visibilité par marque : certaines annotations sont destinées
 * au citoyen, d'autres restent des notes de travail internes.
 *
 * Coordonnées : toutes les géométries sont exprimées en **pourcentage de la
 * page** (0–100) pour rester robustes au zoom et au redimensionnement du
 * viewer — même convention que `highlight_rects` côté réglementaire.
 */
export const dossier_piece_annotations = pgTable(
  "dossier_piece_annotations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Dénormalisé pour lister/scoper sans jointure (toujours = piece.dossier_id). */
    dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
    piece_id: uuid("piece_id").notNull().references(() => dossier_pieces_jointes.id, { onDelete: "cascade" }),
    /** Page concernée pour les PDF multipages ; 1 pour une image. */
    page: integer("page").notNull().default(1),
    /**
     * Type de marque :
     *  - "ellipse"  : entourer (cercle / ellipse)
     *  - "rect"     : encadrer
     *  - "arrow"    : flèche de désignation
     *  - "freehand" : tracé libre (stylo)
     *  - "text"     : étiquette / bulle de texte
     *  - "polygon"  : polygone à sommets (réservé Phase 3 — sommets déplaçables)
     */
    tool: text("tool").notNull(),
    /**
     * Géométrie de la marque, en % de la page. Forme selon `tool` :
     *  - ellipse/rect : { x, y, width, height }
     *  - arrow        : { x1, y1, x2, y2 }
     *  - freehand/polygon : { points: [{x,y}, …] }
     *  - text         : { x, y } (ancre du label)
     */
    geometry: jsonb("geometry").notNull().default({}),
    /** Style de tracé : { color, strokeWidth, fill?, fontSize? }. */
    style: jsonb("style").notNull().default({}),
    /** Commentaire associé à la marque (optionnel). */
    comment: text("comment"),
    /**
     * Visibilité de la marque :
     *  - "interne" (défaut) : note de travail, jamais exportée vers le citoyen
     *  - "citoyen"          : incluse dans l'export aplati envoyé au citoyen
     */
    visibility: text("visibility").notNull().default("interne"),
    author_user_id: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
    updated_at: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    pieceIdx: index("idx_piece_annotations_piece").on(t.piece_id),
    dossierIdx: index("idx_piece_annotations_dossier").on(t.dossier_id),
  }),
);

export type PieceAnnotationTool = "ellipse" | "rect" | "arrow" | "freehand" | "text" | "polygon";
export const PIECE_ANNOTATION_TOOLS: ReadonlyArray<PieceAnnotationTool> = [
  "ellipse", "rect", "arrow", "freehand", "text", "polygon",
];

export type PieceAnnotationVisibility = "interne" | "citoyen";
export const PIECE_ANNOTATION_VISIBILITIES: ReadonlyArray<PieceAnnotationVisibility> = [
  "interne", "citoyen",
];
