import { parseMySportWorkbook, parseRunDbWorkbook, readWorkbook } from '@sportos/importers';

const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.split('=');
  if (key && value) args.set(key.replace(/^--/, ''), value);
}

const mySportPath = args.get('mySport');
const runDbPath = args.get('runDb');

if (!mySportPath && !runDbPath) {
  console.error('Provide --mySport=/path/to/my_sport.xlsx and/or --runDb=/path/to/run-db.xlsx');
  process.exit(1);
}

if (mySportPath) {
  const extract = readWorkbook(mySportPath);
  const parsed = parseMySportWorkbook(extract);
  console.log('my_sport dry run', {
    filename: extract.filename,
    sheets: extract.sheetNames,
    rawRows: extract.rows.length,
    dailyMetrics: parsed.dailyMetrics.length,
    activities: parsed.activities.length,
    firstDailyMetric: parsed.dailyMetrics[0],
    warnings: parsed.warnings,
  });
}

if (runDbPath) {
  const extract = readWorkbook(runDbPath);
  const parsed = parseRunDbWorkbook(extract);
  console.log('run db dry run', {
    filename: extract.filename,
    sheets: extract.sheetNames,
    rawRows: extract.rows.length,
    performanceEvents: parsed.events.length,
    firstEvent: parsed.events[0],
    warnings: parsed.warnings,
  });
}
