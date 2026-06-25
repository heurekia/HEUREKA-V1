// Trace de tous les courriers d'instruction émis par la mairie pour un dossier.
//
// Sert deux usages :
// 1) **Historique auditable** — savoir qui a envoyé quoi, quand, avec quel
//    contenu (le corps est figé dans le snapshot pour ne pas dépendre du
//    template qui peut être modifié après coup).
// 2) **État métier du dossier** — un courrier de "demande de pièces
//    complémentaires" pose le dossier en "incomplet" et lie les pièces
//    concernées, ce qui permet de tracer le cycle complétude / incomplétude
//    sans inventer un sous-statut.
import { pgTable, text, timestamp, jsonb, uuid } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

export const dossier_courriers = pgTable("dossier_courriers", {
  id: uuid("id").primaryKey().defaultRandom(),
  dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
  // Type métier — aligné sur les categories de courrier_templates :
  // "pieces_complementaires", "refus", "non_opposition", "majoration_delai",
  // "notification_decision", "general", etc.
  type: text("type").notNull(),
  // Titre court humain (affiché dans la chronologie).
  subject: text("subject"),
  // Snapshot du corps au moment de l'émission (HTML ou JSON canvas). Indépendant
  // du template d'origine pour rester fiable même si on modifie le template
  // plus tard.
  body_snapshot: text("body_snapshot"),
  // Pièces concernées (pour une demande de complément) :
  //   { piece_id?: string, code_piece?: string, nom: string, raison?: string,
  //     manquante?: boolean }[]
  // manquante=true = pièce jamais déposée. manquante=false = pièce déposée
  // mais jugée insuffisante par l'instructeur.
  pieces_jointes_ids: jsonb("pieces_jointes_ids").$type<Array<{
    piece_id?: string;
    code_piece?: string;
    nom: string;
    raison?: string;
    manquante?: boolean;
  }>>().default([]),
  // Références d'articles juridiques citées (legal_mentions.article_ref).
  articles_cites: jsonb("articles_cites").$type<string[]>().default([]),
  // Pièces jointes référençant des documents de la GED du dossier
  // (dossier_documents) — distinctes de `pieces_jointes_ids` qui, lui, ne fait
  // que désigner des pièces du citoyen à (re)compléter. Ici on porte des
  // documents produits par l'instruction (ex : plan annoté) joints au courrier.
  // Format : DocumentAttachmentRef[] { document_id, nom, url, type }.
  attachments: jsonb("attachments").$type<Array<{
    document_id: string;
    nom: string;
    url: string;
    type: string;
  }>>().default([]),
  // Suivi qui / quand. delivery_method reste libre pour évolutions ("print",
  // "email", "ar"). Aucune contrainte aujourd'hui — on enregistre ce que
  // l'instructeur déclare.
  emis_par: uuid("emis_par").references(() => users.id),
  emis_le: timestamp("emis_le").notNull().defaultNow(),
  delivery_method: text("delivery_method"),
  // Cycle de vie du courrier :
  //   "brouillon" = enregistré mais non émis — modifiable, SANS effet métier
  //                 (le dossier ne bascule pas en incomplet, les pièces ne sont
  //                 pas marquées). Permet de préparer un courrier et de décider
  //                 plus tard quoi en faire.
  //   "envoye"    = émis/transmis — figé, effets métier appliqués.
  // Default "envoye" : les courriers historiques (antérieurs au brouillon)
  // étaient tous émis directement ; le backfill les classe donc en "envoye",
  // ce qui correspond à la réalité.
  statut: text("statut").notNull().default("envoye"),
  // ── Circuit de signature ──
  // "non_requise" = aucun circuit ; "a_signer" = en attente de la signature
  // d'un signataire désigné ; "signee" = signé.
  signature_status: text("signature_status").notNull().default("non_requise"),
  // Signataire désigné (en attente) puis effectif (une fois signé). Réf. users.
  signataire_user_id: uuid("signataire_user_id").references(() => users.id),
  // Traçabilité du circuit : qui a demandé la signature et quand, quand signé.
  signature_requested_by: uuid("signature_requested_by").references(() => users.id),
  signature_requested_at: timestamp("signature_requested_at"),
  signed_at: timestamp("signed_at"),
  // Snapshot des images apposées au moment de la signature (figé : indépendant
  // d'une modification ultérieure du profil signataire).
  signature_image: text("signature_image"),
  tampon_image: text("tampon_image"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});
