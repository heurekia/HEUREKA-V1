import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/heureka_v1";

// Pool configurable via env. La valeur par défaut (max=20) suppose une seule
// instance API : à monter en multi-replica, dimensionner en fonction du nombre
// de répliques × max pour ne pas dépasser la capacité du serveur Postgres.
// Sans ces options, postgres-js limite le pool à ~10 connexions et les
// requêtes concurrentes s'empilent silencieusement.
const max = Number.parseInt(process.env.DB_POOL_MAX ?? "20", 10);
const idle_timeout = Number.parseInt(process.env.DB_POOL_IDLE_TIMEOUT ?? "30", 10);
const connect_timeout = Number.parseInt(process.env.DB_POOL_CONNECT_TIMEOUT ?? "10", 10);
const max_lifetime = Number.parseInt(process.env.DB_POOL_MAX_LIFETIME ?? "1800", 10);

// SSL : activé si DB_SSL=require, sinon laissé au comportement par défaut de
// la chaîne de connexion (`sslmode=require` dans l'URL fonctionne aussi).
const ssl = process.env.DB_SSL === "require" ? ("require" as const) : undefined;

export const client = postgres(connectionString, {
  max,
  idle_timeout,
  connect_timeout,
  max_lifetime,
  ssl,
  onnotice: () => {},
});
export const db = drizzle(client, { schema });
export type DB = typeof db;
