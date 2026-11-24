import { positiveMetricRange, relativePastelBackground } from '../../../shared/util/metric-heat';
import type { SwimLengthRow } from '../activities-api.service';

export function swimLengthHeat(lengths: readonly SwimLengthRow[]) {
  const split = fasterTimeShades(lengths, 'durationS');
  const pace = fasterTimeShades(lengths, 'paceSPer100M');
  return { split, pace, hasVariation: split.some(Boolean) || pace.some(Boolean) };
}

function fasterTimeShades(lengths: readonly SwimLengthRow[], field: 'durationS' | 'paceSPer100M') {
  const times = lengths.map(length => length.kind === 'active' ? length[field] : null);
  const slowest = positiveMetricRange(times)?.max ?? 0;
  const gains = times.map(time => time !== null && Number.isFinite(time) && time > 0 ? slowest - time : 0);
  const range = positiveMetricRange(gains);
  return gains.map(gain => relativePastelBackground(gain, range, '225, 116, 47'));
}
