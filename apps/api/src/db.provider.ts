import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, resolveActivityDetailDatabaseUrl, withAccountContext, type Database, type Kysely } from '@sportos/db';
import { createRequestDatabase } from './request-databases.js';

function usesRequestDatabases(): boolean {
  return process.env.SPORTOS_WORKERS_STAGING === 'true';
}

@Injectable()
export class DbProvider implements OnModuleDestroy {
  readonly db: Kysely<Database> = usesRequestDatabases()
    ? createRequestDatabase(process.env.SPORTOS_STAGING_DATABASE_URL)
    : createDb();

  withAccount<T>(accountId: string, callback: (db: Kysely<Database>) => Promise<T>): Promise<T> {
    return withAccountContext(this.db, accountId, callback);
  }

  async onModuleDestroy() {
    if (!usesRequestDatabases()) await this.db.destroy();
  }
}

@Injectable()
export class ActivityDetailDbProvider implements OnModuleDestroy {
  readonly db: Kysely<Database> = usesRequestDatabases()
    ? createRequestDatabase(process.env.SPORTOS_STAGING_ACTIVITY_DETAIL_DATABASE_URL)
    : createDb(resolveActivityDetailDatabaseUrl());

  withAccount<T>(accountId: string, callback: (db: Kysely<Database>) => Promise<T>): Promise<T> {
    return withAccountContext(this.db, accountId, callback);
  }

  async onModuleDestroy() {
    if (!usesRequestDatabases()) await this.db.destroy();
  }
}
