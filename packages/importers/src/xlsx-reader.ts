import XLSX from 'xlsx';
import type { WorkBook } from 'xlsx';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { rowHash, sha256 } from '@sportos/shared';

export interface WorkbookRow {
  sheetName: string;
  rowIndex: number;
  cells: unknown[];
  object?: Record<string, unknown>;
  hash: string;
}

export interface WorkbookExtract {
  filename: string;
  sha256: string;
  sheetNames: string[];
  rows: WorkbookRow[];
  workbook: WorkBook;
}

export function readWorkbook(path: string): WorkbookExtract {
  const bytes = readFileSync(path);
  const workbook = XLSX.readFile(path, { cellDates: false, cellFormula: true, raw: true, WTF: false });
  const rows: WorkbookRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    for (let i = 0; i < matrix.length; i += 1) {
      const cells = matrix[i] ?? [];
      if (cells.every((cell) => cell === null || cell === undefined || cell === '')) continue;
      rows.push({ sheetName, rowIndex: i + 1, cells, hash: rowHash({ sheetName, rowIndex: i + 1, cells }) });
    }
  }

  return {
    filename: basename(path),
    sha256: sha256(bytes),
    sheetNames: workbook.SheetNames,
    rows,
    workbook,
  };
}

export function sheetMatrix(workbook: WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null, blankrows: false });
}

export function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/\n+/g, '_')
    .replace(/[^a-z0-9а-яё_]+/giu, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function rowObjectFromHeaders(headers: unknown[], cells: unknown[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  headers.forEach((header, idx) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return;
    obj[normalized] = cells[idx] ?? null;
  });
  return obj;
}

export function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const normalized = String(value).trim().replace(',', '.');
  if (normalized === '') return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function asString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}
