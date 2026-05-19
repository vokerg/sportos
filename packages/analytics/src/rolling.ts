export interface DatedValue {
  date: string;
  value: number;
}

export function rollingAverage(rows: DatedValue[], windowSize: number): DatedValue[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const result: DatedValue[] = [];
  let sum = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    sum += sorted[i].value;
    if (i >= windowSize) sum -= sorted[i - windowSize].value;
    const denominator = Math.min(i + 1, windowSize);
    result.push({ date: sorted[i].date, value: sum / denominator });
  }
  return result;
}
