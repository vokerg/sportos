import type { DailyScoreBreakdown } from './score-breakdown.models';

export type DeltaKind = 'positive' | 'negative' | 'zero' | 'unavailable';

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export function deltaKind(delta: number | null): DeltaKind {
  if (delta === null) return 'unavailable';
  if (delta > 0) return 'positive';
  if (delta < 0) return 'negative';
  return 'zero';
}

export function deltaValue(delta: number | null): string {
  if (delta === null) return 'Not available';
  if (delta > 0) return `+${formatNumber(delta)}`;
  if (delta < 0) return `−${formatNumber(Math.abs(delta))}`;
  return '0';
}

export function deltaDescription(delta: number | null): string {
  if (delta === null) return 'No spreadsheet total was imported';
  if (delta > 0) return 'App total is above Excel';
  if (delta < 0) return 'App total is below Excel';
  return 'App and Excel totals match';
}

export function scoreStatusLabel(status: DailyScoreBreakdown['scoreStatus']): string {
  return status === 'imported' ? 'Imported ledger' : status === 'manual' ? 'Manual edit' : 'Calculated';
}

export function scoreAuthorityNote(status: DailyScoreBreakdown['scoreStatus']): string {
  if (status === 'imported') return 'Imported ledger is authoritative';
  if (status === 'manual') return 'Saved manual facts are authoritative';
  return 'Calculated from canonical activities';
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDistance(meters: number | null | undefined, fractionDigits = 2): string {
  if (meters === null || meters === undefined) return '—';
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: fractionDigits })} km`;
}

export function formatSigned(value: number): string {
  if (value > 0) return `+${formatNumber(value)}`;
  if (value < 0) return `−${formatNumber(Math.abs(value))}`;
  return '0';
}

export function ledgerSum(breakdown: DailyScoreBreakdown): number {
  return breakdown.ledger.reduce((sum, entry) => sum + entry.points, 0);
}

export function ledgerMatchesAppTotal(breakdown: DailyScoreBreakdown): boolean {
  return ledgerSum(breakdown) === breakdown.score.appTotal;
}
