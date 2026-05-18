import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

const connectionString = process.env.DATABASE_URL ?? "postgres://localhost:5432/heureka_v1";

const client = postgres(connectionString);
export const db = drizzle(client, { schema });
export type DB = typeof db;
