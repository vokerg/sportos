export interface DailyMetricRange {
  min: number;
  max: number;
  mean: number;
}

export function positiveMetricRange(values: readonly unknown[]): DailyMetricRange | null {
  const positiveValues = values
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!positiveValues.length) return null;
  return { min: Math.min(...positiveValues), max: Math.max(...positiveValues), mean: positiveValues.reduce((sum, value) => sum + value, 0) / positiveValues.length };
}

export function relativePastelBackground(
  value: unknown,
  range: DailyMetricRange | null,
  rgb: string,
): string | undefined {
  const numericValue = Number(value);
  if (!range || !Number.isFinite(numericValue) || numericValue <= 0) return undefined;

  // Anchor typical positive values at medium intensity, reserving the strongest
  // shade for the maximum. An extreme outlier no longer washes out ordinary days.
  const mean = range.mean;
  const position = range.max === range.min ? 0.5 : numericValue <= mean
    ? 0.5 * Math.max(0, Math.min(1, numericValue / mean))
    : 0.5 + 0.5 * Math.min(1, (numericValue - mean) / (range.max - mean));
  const alpha = 0.06 + position * 0.48;
  return `rgba(${rgb}, ${alpha.toFixed(2)})`;
}
