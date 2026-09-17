import { describe, expect, it } from 'vitest';
import { GarminCsvError, readGarminCsvBuffer } from './garmin-csv.js';

function csv(value: string, filename = 'garmin.csv') {
  return readGarminCsvBuffer(Buffer.from(value, 'utf8'), filename);
}

describe('readGarminCsvBuffer', () => {
  it('parses BOM-prefixed weekly steps and keeps overlapping-row identities independent of filenames', () => {
    const first = csv('\uFEFF,Actual\r\n27/09/2019,78736\r\n04/10/2019,90059\r\n', 'first.csv');
    const overlap = csv('\uFEFF,Actual\n04/10/2019,90059\n11/10/2019,55041\n', 'overlap.csv');

    expect(first.reportType).toBe('steps_weekly');
    expect(first.observations).toEqual([
      expect.objectContaining({ identityKey: '2019-09-27', values: { steps: 78_736 }, sourceRowIndex: 2 }),
      expect.objectContaining({ identityKey: '2019-10-04', values: { steps: 90_059 }, sourceRowIndex: 3 }),
    ]);
    expect(overlap.observations[0]?.identityKey).toBe(first.observations[1]?.identityKey);
    expect(overlap.observations[0]?.valueHash).toBe(first.observations[1]?.valueHash);
  });

  it('parses the explicit weekly calorie and floor report layouts', () => {
    const calories = csv('period_label,week_end,active_calories,resting_calories,avg_daily_total\n11-17 Sep,2026-09-17,5723,13576,2757\n');
    const floors = csv('period_label,week_end,climbed_floors,descended_floors\n11-17 Sep,2026-09-17,134,111\n');

    expect(calories).toMatchObject({
      reportType: 'calories_weekly',
      observations: [{ recordedDate: '2026-09-17', values: {
        periodLabel: '11-17 Sep', activeCalories: 5723, restingCalories: 13_576, averageDailyTotal: 2757,
      } }],
    });
    expect(floors).toMatchObject({
      reportType: 'floors_weekly',
      observations: [{ recordedDate: '2026-09-17', values: {
        periodLabel: '11-17 Sep', climbedFloors: 134, descendedFloors: 111,
      } }],
    });
  });

  it('carries explicit date markers into weight observations without inventing a timezone', () => {
    const extract = csv([
      '\uFEFFTime,Weight,Change,BMI,Body Fat,Skeletal Muscle Mass,Bone Mass,Body Water,',
      '" 21 Sep 2023",',
      '17:08,81.4 kg,0.9 kg,24.6,21.5 %,33.4 kg,5.1 kg,57.3 %,',
      '17:08,81.4 kg,0.1 kg,24.6,21.4 %,33.4 kg,5.1 kg,57.4 %,',
      '06:19,82.3 kg,--,--,--,--,--,--,',
    ].join('\n'));

    expect(extract.reportType).toBe('weight_body_composition');
    expect(extract.observations).toEqual([
      expect.objectContaining({
        identityKey: expect.stringMatching(/^2023-09-21T17:08:00:[0-9a-f]{64}$/),
        recordedDate: '2023-09-21',
        recordedTime: '17:08:00',
        values: expect.objectContaining({ weightKg: 81.4, bodyFatPercent: 21.5 }),
      }),
      expect.objectContaining({
        identityKey: expect.stringMatching(/^2023-09-21T17:08:00:[0-9a-f]{64}$/),
        recordedDate: '2023-09-21',
        recordedTime: '17:08:00',
        values: expect.objectContaining({ weightKg: 81.4, bodyFatPercent: 21.4 }),
      }),
      expect.objectContaining({
        identityKey: expect.stringMatching(/^2023-09-21T06:19:00:[0-9a-f]{64}$/),
        values: expect.objectContaining({ weightKg: 82.3, bmi: null }),
      }),
    ]);
    expect(extract.observations[0]?.identityKey).not.toBe(extract.observations[1]?.identityKey);
  });

  it('retains malformed data rows as raw rows and reports bounded warnings', () => {
    const extract = csv(',Actual\nnot-a-date,123\n27/09/2019,not-a-number\n');

    expect(extract.rows).toHaveLength(3);
    expect(extract.observations).toHaveLength(0);
    expect(extract.warnings).toEqual([
      expect.objectContaining({ code: 'GARMIN_ROW_SKIPPED', rowIndex: 2 }),
      expect.objectContaining({ code: 'GARMIN_ROW_SKIPPED', rowIndex: 3 }),
    ]);
  });

  it('rejects unknown report layouts', () => {
    expect(() => csv('mystery,value\nfoo,1\n')).toThrow(
      expect.objectContaining<Partial<GarminCsvError>>({ code: 'UNSUPPORTED_GARMIN_REPORT' }),
    );
  });
});
