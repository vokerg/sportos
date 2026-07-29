import { chromium } from 'playwright';

const summaryRows = [
  dailyRow('2026-05-20', 22, 20, 2),
  dailyRow('2026-05-19', 10, null, null),
  dailyRow('2026-05-18', 25, 24, 1),
];

const normal = {
  date: '2026-05-18',
  recomputedAt: '2026-05-18T12:00:00.000Z',
  facts: { steps: 12345, runM: 5000, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 25, excelTotal: 24, delta: 1, baseTotal: 20, bonusTotal: 5, ledgerTotal: 25 },
  sourceRecord: sourceRecord('daily-row-hash', 2),
  ledger: [
    {
      id: '40000000-0000-4000-8000-000000000001',
      points: 20,
      reason: 'Run distance: 5 × 4',
      calculation: { metric: 'distance_km', metricValue: 5, coefficient: 4 },
      createdAt: '2026-05-18T12:00:00.000Z',
      rule: rule({
        id: '50000000-0000-4000-8000-000000000001',
        code: 'run.distance',
        name: 'Run distance',
        ruleKind: 'coefficient',
        metric: 'distance_km',
        coefficient: 4,
        priority: 10,
      }),
      activity: {
        id: '60000000-0000-4000-8000-000000000001',
        source: 'my_sport_xlsx',
        sourceActivityId: null,
        activityDate: '2026-05-18',
        startTime: null,
        activityType: 'run',
        subtype: 'outdoor',
        distanceM: 5000,
        durationS: 1200,
        movingTimeS: null,
        steps: null,
        calories: null,
        avgHr: null,
        maxHr: null,
        elevationGainM: null,
        avgSpeedMps: null,
        avgPaceSPerKm: null,
        effortPoints: null,
        notes: 'Morning 5k',
        sourceRecord: sourceRecord('activity-row-hash', 2),
      },
    },
    {
      id: '40000000-0000-4000-8000-000000000002',
      points: 5,
      reason: '5 km under 25 minutes: +5',
      calculation: { metric: 'duration_s', thresholdOperator: 'lt', thresholdValue: 1500 },
      createdAt: '2026-05-18T12:00:01.000Z',
      rule: rule({
        id: '50000000-0000-4000-8000-000000000002',
        code: 'run.5k.sub25.bonus',
        name: '5 km under 25 minutes',
        ruleKind: 'achievement',
        metric: 'duration_s',
        thresholdOperator: 'lt',
        thresholdValue: 1500,
        thresholdUnit: 'seconds',
        configuredPoints: 5,
        priority: 100,
      }),
      activity: null,
    },
  ],
};

const noExcel = {
  date: '2026-05-19',
  recomputedAt: '2026-05-19T12:00:00.000Z',
  facts: { steps: 1000, runM: 1500, bikeM: 0, swimM: 0, workoutPoints: 0, powerPoints: 0 },
  score: { appTotal: 10, excelTotal: null, delta: null, baseTotal: 10, bonusTotal: 0, ledgerTotal: 10 },
  sourceRecord: null,
  ledger: [
    {
      id: '40000000-0000-4000-8000-000000000003',
      points: 10,
      reason: 'Daily activity points',
      calculation: { metric: 'distance_km', metricValue: 1.5 },
      createdAt: '2026-05-19T12:00:00.000Z',
      rule: null,
      activity: null,
    },
  ],
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`));
page.on('pageerror', (error) => console.error(`[browser:error] ${error.message}`));
page.on('requestfailed', (request) => console.error(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`));

await page.route('**/daily/summary**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summaryRows) });
});

await page.route('**/daily/*/score-breakdown', async (route) => {
  const date = new URL(route.request().url()).pathname.split('/')[2];
  if (date === '2026-05-18') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(normal) });
    return;
  }
  if (date === '2026-05-19') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(noExcel) });
    return;
  }
  await route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({
      code: 'SCORE_BREAKDOWN_INCONSISTENT',
      message: 'The persisted score breakdown failed consistency checks.',
      date,
    }),
  });
});

await page.goto('http://127.0.0.1:4200', { waitUntil: 'domcontentloaded' });
await page.locator('sportos-daily-log').waitFor();
await page.locator('.ag-pinned-left-cols-container .ag-row').first().waitFor();
await page.waitForTimeout(500);
await page.screenshot({ path: 'evidence/initial-daily-log.png', fullPage: true });
console.log(`Pinned grid rows: ${await page.locator('.ag-pinned-left-cols-container .ag-row').count()}`);
console.log(`Explain buttons: ${await page.locator('button.explain-button').count()}`);

await capture(page, '2026-05-18', 'evidence/normal-reconciliation.png', 'Matches app total');
await page.locator('button[aria-label="Close score breakdown"]').click();
await capture(page, '2026-05-19', 'evidence/no-excel-total.png', 'No spreadsheet total was imported');
await page.locator('button[aria-label="Close score breakdown"]').click();
await capture(page, '2026-05-20', 'evidence/api-error.png', 'failed consistency checks');

await browser.close();

async function capture(page, date, path, expectedText) {
  const row = page.locator('.ag-pinned-left-cols-container .ag-row').filter({ hasText: date });
  await row.waitFor();
  await row.locator('button.explain-button').click();
  const panel = page.locator('sportos-score-breakdown-panel');
  await panel.getByText(expectedText, { exact: false }).waitFor();
  await panel.screenshot({ path });
}

function dailyRow(metricDate, total, excel, delta) {
  return {
    metric_date: metricDate,
    steps: 12345,
    run_m: 5000,
    bike_m: 0,
    swim_m: 0,
    workout_points: 0,
    power_points: 0,
    base_points: total,
    bonus_points: 0,
    total_points: total,
    excel_all_points: excel,
    points_delta_vs_excel: delta,
    avg_10d: total,
    avg_20d: total,
    avg_30d: total,
    avg_60d: total,
    avg_365d: total,
  };
}

function sourceRecord(rowHash, rowIndex) {
  return {
    id: `70000000-0000-4000-8000-${String(rowIndex).padStart(12, '0')}`,
    rowHash,
    sheetName: 'Sheet1',
    rowIndex,
    batch: {
      id: '80000000-0000-4000-8000-000000000001',
      source: 'my_sport_xlsx',
      filename: 'synthetic-my-sport.xlsx',
      originalSha256: 'synthetic-file-hash',
      status: 'scored',
      startedAt: '2026-05-18T11:59:00.000Z',
      completedAt: '2026-05-18T12:00:00.000Z',
    },
  };
}

function rule(overrides) {
  return {
    id: overrides.id,
    code: overrides.code,
    name: overrides.name,
    activityType: 'run',
    ruleKind: overrides.ruleKind,
    metric: overrides.metric,
    coefficient: overrides.coefficient ?? null,
    thresholdOperator: overrides.thresholdOperator ?? null,
    thresholdValue: overrides.thresholdValue ?? null,
    thresholdUnit: overrides.thresholdUnit ?? null,
    configuredPoints: overrides.configuredPoints ?? null,
    validFrom: '2026-01-01',
    validTo: null,
    priority: overrides.priority,
    enabled: true,
    description: 'Synthetic evidence rule',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}
