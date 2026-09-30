import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

/**
 * Base PostgreSQL (Supabase). Les migrations sont dans drizzle/migrations ; les anciennes migrations
 * MySQL/TiDB, gardées pour l'historique, dans drizzle/mysql-legacy — elles ne s'appliquent plus.
 */
export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
