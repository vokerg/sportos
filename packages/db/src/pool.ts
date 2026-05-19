import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './schema.js';

export function createDb(databaseUrl = process.env.DATABASE_URL): Kysely<Database> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: databaseUrl }),
    }),
  });
}
