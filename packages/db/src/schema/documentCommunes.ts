import { pgTable, timestamp, uuid, unique, index } from "drizzle-orm/pg-core";
import { regulatory_documents } from "./regulatoryDocuments.js";
import { communes } from "./communes.js";

// Rattachement N:N document → communes. Source de vérité du périmètre
// d'applicabilité d'un document réglementaire :
//  - PLU strictement communal → 1 ligne
//  - PLUi (porteur EPCI)      → N lignes, une par commune membre couverte
//
// regulatory_documents.commune_id reste renseigné pour rétro-compatibilité.
// À retirer une fois loadRules() et loadCandidateRuleIds() migrés (Lots 3 & 4).
export const document_communes = pgTable(
  "document_communes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    document_id: uuid("document_id")
      .notNull()
      .references(() => regulatory_documents.id, { onDelete: "cascade" }),
    commune_id: uuid("commune_id")
      .notNull()
      .references(() => communes.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniq: unique("document_communes_unique").on(t.document_id, t.commune_id),
    documentIdx: index("idx_document_communes_document").on(t.document_id),
    communeIdx: index("idx_document_communes_commune").on(t.commune_id),
  }),
);
