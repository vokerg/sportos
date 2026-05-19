import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, type Database } from '@sportos/db';
import type { Kysely } from 'kysely';

@Injectable()
export class DbProvider implements OnModuleDestroy {
  readonly db: Kysely<Database> = createDb();

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
