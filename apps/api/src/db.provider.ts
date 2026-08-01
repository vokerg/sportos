import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, withAccountContext, type Database, type Kysely } from '@sportos/db';

@Injectable()
export class DbProvider implements OnModuleDestroy {
  readonly db: Kysely<Database> = createDb();

  withAccount<T>(accountId: string, callback: (db: Kysely<Database>) => Promise<T>): Promise<T> {
    return withAccountContext(this.db, accountId, callback);
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
