import { expect, it } from 'vitest';
import type { SwimLengthRow } from '../activities-api.service';
import { swimLengthHeat } from './swim-length-table.view-model';

const length: SwimLengthRow = {
  row: 1, lengthNumber: 1, kind: 'active', durationS: 30, durationBasis: 'timer',
  paceSPer100M: 120, strokes: 15, swolf: 45, stroke: 'freestyle',
};

it('shades faster active lengths without treating rest, unknown or missing times as faster', () => {
  const heat = swimLengthHeat([
    length,
    { ...length, durationS: 27, paceSPer100M: 108 },
    { ...length, durationS: 25, paceSPer100M: 100 },
    { ...length, kind: 'rest', durationS: 10, paceSPer100M: null },
    { ...length, kind: 'unknown', durationS: 6, paceSPer100M: null },
    { ...length, durationS: null, paceSPer100M: null },
  ]);
  const expected = [undefined, 'rgba(225, 116, 47, 0.24)', 'rgba(225, 116, 47, 0.54)', undefined, undefined, undefined];
  expect(heat).toEqual({ split: expected, pace: expected, hasVariation: true });
  expect(swimLengthHeat([length, length]).hasVariation).toBe(false);
});
