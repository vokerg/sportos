import type {
  DailyScoreBreakdown,
  JsonValue,
  ScoreBreakdownActivity,
  ScoreBreakdownLedgerEntry,
  SourceRecordReference,
} from './score-breakdown.models';
import { formatDate, formatDateTime } from './date-time';

export type DeltaKind = 'positive' | 'negative' | 'zero' | 'unavailable';

export interface ImportedLedgerInput {
  key: string;
  label: string;
  reference: string | null;
  value: number;
}

export interface ImportedLedgerDetails {
  formula: string | null;
  inputs: ImportedLedgerInput[];
  additiveFormula: boolean;
  showEquation: boolean;
  inputTotal: number | null;
  matchesTotal: boolean;
}

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

export function formatScoreDate(value: string | null | undefined): string {
  return formatDate(value);
}

export function formatTimestamp(value: string | null | undefined, fallback = 'Not available'): string {
  return formatDateTime(value, fallback);
}

export function formatDistance(meters: number | null | undefined, fractionDigits = 2): string {
  if (meters === null || meters === undefined) return '—';
  return `${(meters / 1000).toLocaleString('en-US', { maximumFractionDigits: fractionDigits })} km`;
}

export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function formatPace(secondsPerKm: number): string {
  const rounded = Math.max(0, Math.round(secondsPerKm));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}/km`;
}

export function formatSpeed(metersPerSecond: number): string {
  return `${(metersPerSecond * 3.6).toLocaleString('en-US', { maximumFractionDigits: 2 })} km/h`;
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

export function importedLedgerDetails(
  entry: ScoreBreakdownLedgerEntry,
  breakdown: DailyScoreBreakdown,
): ImportedLedgerDetails | null {
  if (breakdown.scoreStatus !== 'imported' || entry.rule !== null || entry.activity !== null) return null;

  const calculation = jsonRecord(entry.calculation);
  const formula = jsonString(calculation?.workbookFormula) ?? sourceWorkbookFormula(breakdown.sourceRecord);
  const persistedInputs = formulaInputsFromJson(calculation?.workbookFormulaInputs);
  const inputs = persistedInputs.length > 0
    ? persistedInputs
    : formula
      ? formulaInputsFromSource(formula, breakdown.sourceRecord)
      : candidateWorkbookInputs(breakdown.sourceRecord);
  const persistedAdditive = jsonBoolean(calculation?.workbookFormulaIsAdditive);
  const additiveFormula = persistedAdditive ?? (formula !== null && isAdditiveWorkbookFormula(formula));
  const inputTotal = inputs.length > 0 ? inputs.reduce((sum, input) => sum + input.value, 0) : null;
  const matchesTotal = inputTotal !== null && Math.abs(inputTotal - entry.points) < 1e-9;

  return {
    formula,
    inputs,
    additiveFormula,
    showEquation: inputs.length > 0 && (additiveFormula || (formula === null && matchesTotal)),
    inputTotal,
    matchesTotal,
  };
}

export function formatWorkbookFormula(value: string): string {
  const formula = value.trim();
  return formula.startsWith('=') ? formula : `=${formula}`;
}

export function importedEquationLabel(details: ImportedLedgerDetails, importedTotal: number): string {
  const terms = details.inputs
    .map((input) => `${input.label} ${formatNumber(input.value)}`)
    .join(' plus ');
  const inputTotal = details.inputTotal === null ? 'unavailable' : formatNumber(details.inputTotal);
  return `${details.formula ? 'Workbook formula inputs' : 'Available cached workbook values'}: ${terms} equals ${inputTotal}; imported All ${formatNumber(importedTotal)}`;
}

export function calculationLabel(value: JsonValue): string {
  if (value === null) return 'No calculation inputs';
  if (Array.isArray(value)) return value.map(calculationLabel).join(', ');
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length === 0
      ? 'No calculation inputs'
      : entries.map(([key, item]) => `${humanize(key)}: ${calculationLabel(item)}`).join(' · ');
  }
  return String(value);
}

export function activityLabel(activity: ScoreBreakdownActivity | null): string {
  if (!activity) return 'No linked activity';
  const parts = [humanize(activity.activityType), activity.subtype ? humanize(activity.subtype) : null];
  if (activity.distanceM !== null) parts.push(`${formatNumber(activity.distanceM / 1000)} km`);
  if (activity.durationS !== null) parts.push(formatDuration(activity.durationS));
  if (activity.steps !== null) parts.push(`${formatNumber(activity.steps)} steps`);
  if (activity.effortPoints !== null) parts.push(`${formatNumber(activity.effortPoints)} effort`);
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

export function activityName(activity: ScoreBreakdownActivity): string {
  const parts = [humanize(activity.activityType), activity.subtype ? humanize(activity.subtype) : null];
  return parts.filter((part): part is string => Boolean(part)).join(' · ');
}

export function sourceName(source: string): string {
  if (source === 'my_sport_xlsx') return 'Excel';
  if (source === 'strava' || source === 'strava_api') return 'Strava';
  if (source === 'run_db_xlsx') return 'Run DB';
  if (source === 'manual' || source === 'manual_daily_edit') return 'Manual';
  return humanize(source);
}

export function activityIsInLedger(activity: ScoreBreakdownActivity, breakdown: DailyScoreBreakdown): boolean {
  return breakdown.ledger.some((entry) => entry.activity?.id === activity.id);
}

export function activityScoreLabel(activity: ScoreBreakdownActivity, breakdown: DailyScoreBreakdown): string {
  if (activityIsInLedger(activity, breakdown)) return 'In ledger';
  if (breakdown.scoreStatus === 'manual' && activity.source === 'manual') return 'Daily fact';
  if (activity.source === 'my_sport_xlsx') return 'Daily fact';
  return 'Context only';
}

export function sourceRecordTitle(record: SourceRecordReference): string {
  const location = record.sheetName
    ? `${record.sheetName}${record.rowIndex === null ? '' : ` row ${record.rowIndex}`}`
    : record.normalizedEntityId || 'provider activity';
  return `${record.batch.filename || sourceName(record.batch.source)} · ${location}`;
}

export function hasWorkbookCells(value: JsonValue): boolean {
  return workbookCells(value).length > 0;
}

export function workbookCells(value: JsonValue): JsonValue[] {
  const record = jsonRecord(value);
  return Array.isArray(record?.cells) ? record.cells : [];
}

export function workbookHeader(value: JsonValue, index: number): string {
  const record = jsonRecord(value);
  const headers = Array.isArray(record?.headers) ? record.headers : [];
  const header = headers[index];
  return header === null || header === undefined || header === '' ? `Column ${index + 1}` : String(header).replace(/\n/g, ' ');
}

export function rawValueLabel(value: JsonValue): string {
  if (value !== null && typeof value === 'object') return jsonLabel(value);
  return value === null ? 'null' : String(value);
}

export function jsonLabel(value: JsonValue): string {
  return JSON.stringify(value, null, 2) ?? String(value);
}

export function sourceSummary(source: SourceRecordReference | null): string {
  if (!source) return 'Source link unavailable';
  if (source.batch.source === 'manual_daily_edit') return 'Manual daily facts';
  const workbook = source.batch.filename || source.batch.source;
  const location = source.sheetName
    ? `${source.sheetName}${source.rowIndex === null ? '' : ` row ${source.rowIndex}`}`
    : source.rowIndex === null ? 'row unavailable' : `row ${source.rowIndex}`;
  return `${workbook} · ${location}`;
}

export function ruleLabel(entry: ScoreBreakdownLedgerEntry): string {
  return entry.rule ? `${entry.rule.name} (${entry.rule.code})` : 'Rule unavailable';
}

function formulaInputsFromJson(value: JsonValue | undefined): ImportedLedgerInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const record = jsonRecord(item);
    const sourceColumn = jsonString(record?.sourceColumn);
    const numericValue = jsonNumber(record?.value);
    if (!sourceColumn || numericValue === null) return [];
    const reference = jsonString(record?.cellReference);
    return [{
      key: `persisted:${sourceColumn}:${reference ?? index}`,
      label: workbookColumnLabel(sourceColumn),
      reference,
      value: numericValue,
    }];
  });
}

function sourceWorkbookFormula(source: SourceRecordReference | null): string | null {
  const sourceRecord = jsonRecord(source?.rawJson);
  const formulas = jsonRecord(sourceRecord?.formulas);
  return jsonString(formulas?.all);
}

function formulaInputsFromSource(formula: string, source: SourceRecordReference | null): ImportedLedgerInput[] {
  const workbook = workbookSourceData(source);
  const rowIndex = source?.rowIndex;
  if (!workbook || rowIndex === null || rowIndex === undefined) return [];

  const inputs: ImportedLedgerInput[] = [];
  const seen = new Set<string>();
  const referencePattern = /\$?([A-Z]{1,3})\$?(\d+)/gi;
  for (const match of formula.matchAll(referencePattern)) {
    const columnLetters = match[1];
    const referencedRow = Number(match[2]);
    if (!columnLetters || referencedRow !== rowIndex) continue;

    const columnIndex = excelColumnIndex(columnLetters);
    const sourceColumn = workbookKey(workbook.headers[columnIndex]);
    const numericValue = sourceNumber(workbook.cells[columnIndex]);
    const reference = match[0].replaceAll('$', '').toUpperCase();
    if (!sourceColumn || numericValue === null || seen.has(reference)) continue;

    seen.add(reference);
    inputs.push({
      key: `source:${sourceColumn}:${reference}`,
      label: workbookColumnLabel(sourceColumn),
      reference,
      value: numericValue,
    });
  }
  return inputs;
}

function candidateWorkbookInputs(source: SourceRecordReference | null): ImportedLedgerInput[] {
  const workbook = workbookSourceData(source);
  if (!workbook) return [];

  const scoreColumns = new Set(['steps', 'run_to_s', 'bike_to_s', 'sup_to_s', 'raw_to_s', 'swim_to_s', 'wototal', 'pow']);
  const seen = new Set<string>();
  return workbook.headers.flatMap((header, index) => {
    const sourceColumn = workbookKey(header);
    const numericValue = sourceNumber(workbook.cells[index]);
    if (!scoreColumns.has(sourceColumn) || numericValue === null || numericValue === 0 || seen.has(sourceColumn)) return [];
    seen.add(sourceColumn);
    return [{
      key: `candidate:${sourceColumn}:${index}`,
      label: workbookColumnLabel(sourceColumn),
      reference: null,
      value: numericValue,
    }];
  });
}

function workbookSourceData(source: SourceRecordReference | null): { headers: JsonValue[]; cells: JsonValue[] } | null {
  const record = jsonRecord(source?.rawJson);
  const headers = record?.headers;
  const cells = record?.cells;
  return Array.isArray(headers) && Array.isArray(cells) ? { headers, cells } : null;
}

function workbookKey(value: JsonValue | undefined): string {
  if (value === null || value === undefined || typeof value === 'object') return '';
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function workbookColumnLabel(sourceColumn: string): string {
  const labels: Record<string, string> = {
    steps: 'Steps',
    run: 'Run',
    bike: 'Bike',
    swim: 'Swim',
    run_to_s: 'Run to S',
    bike_to_s: 'Bike to S',
    sup_to_s: 'SUP to S',
    raw_to_s: 'Rowing to S',
    swim_to_s: 'Swim to S',
    wototal: 'WOtotal',
    hiit: 'HIIT',
    raw: 'Rowing',
    sup: 'SUP',
    pow: 'Pow',
  };
  return labels[sourceColumn] ?? humanize(sourceColumn);
}

function sourceNumber(value: JsonValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function excelColumnIndex(columnLetters: string): number {
  let value = 0;
  for (const character of columnLetters.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value - 1;
}

function isAdditiveWorkbookFormula(formula: string): boolean {
  return /^\s*=?\s*\$?[A-Z]{1,3}\$?\d+(?:\s*\+\s*\$?[A-Z]{1,3}\$?\d+)*\s*$/i.test(formula);
}

function jsonString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function jsonNumber(value: JsonValue | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonBoolean(value: JsonValue | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

function jsonRecord(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as { [key: string]: JsonValue }
    : null;
}
