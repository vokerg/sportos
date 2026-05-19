import { createDb } from '@sportos/db';
import { ImportService } from '@sportos/importers';

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  if (key && value) args.set(key.replace(/^--/, ''), value);
}

const mySportPath = args.get('mySport') ?? process.env.MY_SPORT_XLSX;
const runDbPath = args.get('runDb') ?? process.env.RUN_DB_XLSX;

if (!mySportPath && !runDbPath) {
  console.error('Provide --mySport=/path/to/my_sport.xlsx and/or --runDb=/path/to/run-db.xlsx');
  process.exit(1);
}

const db = createDb();
try {
  const service = new ImportService(db);
  const result = await service.importLocalFiles({ mySportPath, runDbPath });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await db.destroy();
}
