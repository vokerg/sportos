/** Swim facts are stored in meters; display the same unit used for scoring. */
export function formatSwimMeters(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (!Number.isFinite(value)) return String(value);
  if (value > 0 && value < 0.001) return '<0.001 m';
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 3 })} m`;
}
