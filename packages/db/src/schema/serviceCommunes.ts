import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { external_services } from "./externalServices.js";
import { communes } from "./communes.js";

export const service_communes = pgTable("service_communes", {
  service_id: uuid("service_id").notNull().references(() => external_services.id, { onDelete: "cascade" }),
  commune_id: uuid("commune_id").notNull().references(() => communes.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.service_id, t.commune_id] })]);
