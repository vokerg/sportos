import { Kysely, PostgresDialect } from 'kysely';
import { Pool, types as pgTypes } from 'pg';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { Database } from './schema.js';

export function createDb(databaseUrl = process.env.DATABASE_URL): Kysely<Database> {
  if (!databaseUrl) {
    loadEnvFromNearestFile();
    databaseUrl = process.env.DATABASE_URL;
  }
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        // PostgreSQL DATE values are calendar dates, not instants. Keep them
        // as strings so the process timezone cannot move them to the prior day.
        types: {
          getTypeParser(oid, format) {
            if (oid === 1082 && format === 'text') return (value: string) => value;
            return pgTypes.getTypeParser(oid, format);
          },
        },
      }),
    }),
  });
}

function loadEnvFromNearestFile(startDir = process.cwd()): void {
  let dir = startDir;
  const root = parse(dir).root;

  while (true) {
    const envPath = join(dir, '.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;

        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }

    if (dir === root) return;
    dir = dirname(dir);
  }
}
