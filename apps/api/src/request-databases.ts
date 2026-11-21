import { AsyncLocalStorage } from 'node:async_hooks';
import { createDb, type Database, type Kysely } from '@sportos/db';

type SportosDb = Kysely<Database>;
const requestDatabases = new AsyncLocalStorage<Map<string, SportosDb>>();

export async function withRequestDatabases<T>(run: () => Promise<T>): Promise<T> {
  const databases = new Map<string, SportosDb>();
  try {
    return await requestDatabases.run(databases, run);
  } finally {
    await Promise.all([...databases.values()].map(db => db.destroy()));
  }
}

export function createRequestDatabase(databaseUrl: string | undefined): SportosDb {
  if (!databaseUrl) throw new Error('A staging database connection is required.');
  // Repositories may retain this handle during Nest bootstrap. The actual pool
  // and its sockets belong to the invocation that executes each query.
  return new Proxy({} as SportosDb, {
    get(_target, property) {
      const databases = requestDatabases.getStore();
      if (!databases) throw new Error('Request database scope is unavailable.');
      let db = databases.get(databaseUrl);
      if (!db) {
        db = createDb(databaseUrl, { max: 2 });
        databases.set(databaseUrl, db);
      }
      const member: unknown = Reflect.get(db, property);
      return typeof member === 'function' ? member.bind(db) : member;
    },
  });
}
