import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMySportWorkbook } from './my-sport.importer.js';
import { parseRunDbWorkbook } from './run-db.importer.js';
import { writeMySportFixture, writeRunDbFixture } from './test-fixtures/xlsx-fixtures.js';
import { readWorkbook } from './xlsx-reader.js';

describe('sanitized XLSX fixture harness', () => {
  it('extracts hidden/helper sheets, cached formulas, and stable row hashes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sportos-xlsx-fixture-'));

    try {
      const firstPath = join(directory, 'my-sport-first.xlsx');
      const secondPath = join(directory, 'my-sport-second.xlsx');
      writeMySportFixture(firstPath);
      writeMySportFixture(secondPath);

      const first = readWorkbook(firstPath);
      const second = readWorkbook(secondPath);

      expect(first.sheetNames).toEqual(['Sheet1', 'Sheet8', 'Sheet2', 'Unexpected Notes']);
      expect(first.workbook.Workbook?.Sheets?.find((sheet) => sheet.name === 'Sheet2')?.Hidden).toBe(1);
      expect(first.rows.find((row) => row.sheetName === 'Sheet1' && row.rowIndex === 2)?.cells[19]).toBe(2_468);
      expect(first.rows.some((row) => row.sheetName === 'Sheet2')).toBe(true);
      expect(first.rows.some((row) => row.sheetName === 'Unexpected Notes')).toBe(true);

      expect(rowHashSnapshot(first)).toEqual(rowHashSnapshot(second));
      expect(first.rows.every((row) => /^[a-f0-9]{64}$/.test(row.hash))).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('normalizes every supported daily-ledger value and warns without guessing', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sportos-my-sport-fixture-'));

    try {
      const path = join(directory, 'my-sport.xlsx');
      writeMySportFixture(path);
      const extract = readWorkbook(path);
      const result = parseMySportWorkbook(extract);

      expect(result.dailyMetrics).toHaveLength(2);
      expect(result.dailyMetrics[0]).toMatchObject({
        metricDate: '2026-05-18',
        steps: 12_345,
        runM: 13_000,
        bikeM: 35_000,
        swimM: 1_000,
        workoutPoints: 8,
        powerPoints: 7,
        excelAllPoints: 2_468,
      });
      expect(result.dailyMetrics[0]?.excelRowHash).toMatch(/^[a-f0-9]{64}$/);
      expect(result.dailyMetrics[1]).toMatchObject({
        metricDate: '2026-05-19',
        steps: 1_000,
        runM: 1_500,
        bikeM: 0,
        swimM: 0,
        workoutPoints: 0,
        powerPoints: 0,
      });
      expect(result.dailyMetrics[1]?.excelAllPoints).toBeUndefined();

      expect(result.activities).toHaveLength(13);
      expect(result.activities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'run', subtype: 'treadmill', distanceM: 5_000 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'run', subtype: 'outdoor', distanceM: 7_500 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'bike', subtype: 'indoor', distanceM: 10_000 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'bike', subtype: 'outdoor', distanceM: 20_000 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'sup', distanceM: 2_500 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'rowing', effortPoints: 5 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'hiit', effortPoints: 3 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'swim', distanceM: 1_000 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'workout', effortPoints: 8 }),
          expect.objectContaining({ activityDate: '2026-05-18', activityType: 'power_bonus', effortPoints: 7 }),
          expect.objectContaining({ activityDate: '2026-05-19', activityType: 'run', subtype: 'outdoor', distanceM: 1_500 }),
        ]),
      );

      expect(result.activities[0]?.rawPayloadJson).toMatchObject({
        sheetName: 'Sheet1',
        rowIndex: 2,
        row: {
          run_to_s: 13_000,
          bike_to_s: 35_000,
          sup_to_s: 2_500,
          raw_to_s: 5,
          swim_to_s: 1_000,
          a10: 100,
          a20d: 200,
          '30all': 300,
          a60d: 600,
          a365: 3_650,
          mystery_metric: 'must remain raw only',
        },
      });

      expect(result.warnings).toEqual([
        "Ignored unknown daily-ledger sheet 'Unexpected Notes'.",
        "Ignored unknown daily-ledger column 'Mystery Metric' (normalized as 'mystery_metric').",
        'Skipped Sheet1 row 3 because Date is missing or invalid.',
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('normalizes all confirmed running sheets and reports ambiguous data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sportos-run-db-fixture-'));

    try {
      const path = join(directory, 'running-performance.xlsx');
      writeRunDbFixture(path);
      const extract = readWorkbook(path);
      const result = parseRunDbWorkbook(extract);

      expect(extract.rows.some((row) => row.sheetName === 'Лист12')).toBe(true);
      expect(extract.rows.some((row) => row.sheetName === 'Helper')).toBe(true);
      expect(extract.rows.some((row) => row.sheetName === 'Mystery Distance')).toBe(true);

      expect(result.events).toHaveLength(7);
      expect(result.events.map((event) => event.distanceM)).toEqual([5_000, 10_000, 12_000, 21_100, 42_195, 5_000, 10_000]);
      expect(result.events.map((event) => event.durationS)).toEqual([1_200, 3_000, 3_600, 7_200, 14_400, 1_500, 3_300]);
      expect(result.events.map((event) => event.eventDate)).toEqual([
        '2026-05-18',
        '2026-05-18',
        '2026-05-18',
        '2026-05-18',
        '2026-05-18',
        '2026-05-19',
        '2026-05-19',
      ]);

      expect(result.events[0]).toMatchObject({
        paceSPerKm: 240,
        isTreadmill: true,
        isPrMarker: true,
        sourceRank: 1,
      });
      expect(result.events[0]?.tags).toEqual(['5k(sorted', '1', 'treadmill', 'starred']);
      expect(result.events[1]?.sourceRank).toBe(2);
      expect(result.events[3]?.tags).toContain('race-day-note');

      expect(result.warnings).toEqual([
        "Skipped performance row '5k(sorted'!3 because time or date is missing or invalid.",
        "Skipped performance sheet 'Лист12' because distance mapping is not confirmed.",
        "Skipped performance sheet 'Helper' because distance mapping is not confirmed.",
        "Skipped performance sheet 'Mystery Distance' because distance mapping is not confirmed.",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function rowHashSnapshot(extract: ReturnType<typeof readWorkbook>): Array<{ sheetName: string; rowIndex: number; hash: string }> {
  return extract.rows.map(({ sheetName, rowIndex, hash }) => ({ sheetName, rowIndex, hash }));
}
