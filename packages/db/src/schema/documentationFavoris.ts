import { pgTable, text, timestamp, uuid, uniqueIndex } from "drizzle-orm/pg-core";
import { dossiers } from "./dossiers.js";
import { users } from "./users.js";

// Favoris « épinglés » par un instructeur sur un dossier — références
// réglementaires qu'il veut retrouver vite pendant l'instruction (cf. onglet
// Documentation contextuelle dans le visualiseur de pièces).
//
// La référence n'est volontairement PAS une clé étrangère : on stocke un
// identifiant logique (par ex. UUID d'une zone_regulatory_rule, ou un id
// synthétique « oap:<commune_doc_id> » / « servitude:<categorie> »). Cela
// permet d'épingler indifféremment une règle PLU, un OAP, un PPRI ou un autre
// type futur sans schéma multi-tables.
export const documentation_favoris = pgTable(
  "documentation_favoris",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dossier_id: uuid("dossier_id").notNull().references(() => dossiers.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Identifiant logique de la référence : "rule:<uuid>", "doc:<uuid>",
    // "servitude:<code>", … — opaque pour la couche persistance.
    reference_id: text("reference_id").notNull(),
    // Type de référence — décide comment le front en affiche le détail :
    // "plu_rule" | "commune_document" | "oap" | "servitude" | "code_urbanisme".
    reference_type: text("reference_type").notNull(),
    // Snapshot du titre au moment de l'épinglage : la règle peut être
    // renommée / archivée ; le favori reste lisible.
    titre: text("titre").notNull(),
    source: text("source"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    unique_per_user: uniqueIndex("documentation_favoris_user_ref_uniq")
      .on(t.dossier_id, t.user_id, t.reference_id),
  }),
);
