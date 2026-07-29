import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createDb, type Database, type Kysely } from '@sportos/db';

@Injectable()
export class DbProvider implements OnModuleDestroy {
  readonly db: Kysely<Database> = createDb();

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
