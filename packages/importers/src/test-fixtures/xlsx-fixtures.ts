import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import XLSX from 'xlsx';
import type { WorkSheet } from 'xlsx';

export const MY_SPORT_HEADERS: string[] = [
  'Date',
  'Steps',
  'R IN',
  'R Out',
  'Bike IN',
  'SUP',
  'HIIT',
  'raw',
  'Bike OUT',
  'WOtotal',
  'Swim',
  'Pow',
  'Bike',
  'Run',
  'Run to S',
  'Bike to S',
  'sup to s',
  'raw to s',
  'Swim to S',
  'All',
  'A10',
  'A20d',
  '30(All)',
  'A60d',
  'A365',
  'Mystery Metric',
];

const EXCEL_DATE_2026_05_18 = 46160;
const EXCEL_DATE_2026_05_19 = 46161;

export function writeCleanMySportFixture(path: string): void {
  ensureParentDirectory(path);
  const workbook = XLSX.utils.book_new();
  const knownHeaders = MY_SPORT_HEADERS.slice(0, -1);
  const sheet = XLSX.utils.aoa_to_sheet([
    knownHeaders,
    [EXCEL_DATE_2026_05_18, 10_000, 5],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  XLSX.writeFile(workbook, path, { compression: true });
}

export function writeMySportFixture(path: string): void {
  ensureParentDirectory(path);

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    MY_SPORT_HEADERS,
    [
      EXCEL_DATE_2026_05_18,
      12_345,
      5,
      7.5,
      10,
      2.5,
      3.4,
      4.6,
      20,
      8.4,
      1_000,
      6.6,
      35,
      13,
      13_000,
      22_750,
      2_500,
      5,
      7_500,
      55_610,
      100,
      200,
      300,
      600,
      3_650,
      'must remain raw only',
    ],
    [null, 999, null, 2, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 999],
    [EXCEL_DATE_2026_05_19, '1000', null, '1,5'],
  ]);

  setCachedFormula(sheet, 'M2', 'E2+I2', 35);
  setCachedFormula(sheet, 'N2', 'C2+D2', 13);
  setCachedFormula(sheet, 'O2', 'N2*1000', 13_000);
  setCachedFormula(sheet, 'P2', 'M2*650', 22_750);
  setCachedFormula(sheet, 'S2', 'K2*7.5', 7_500);
  setCachedFormula(sheet, 'T2', 'B2+O2+P2+S2+J2+L2', 55_610);

  XLSX.utils.book_append_sheet(workbook, sheet, 'Sheet1');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), 'Sheet8');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['key', 'value'],
      ['synthetic coefficient', 1],
    ]),
    'Sheet2',
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['unsupported notes']]), 'Unexpected Notes');

  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    Sheets: workbook.SheetNames.map((name) => ({ name, Hidden: name === 'Sheet2' ? 1 : 0 })),
  };

  XLSX.writeFile(workbook, path, { compression: true });
}

export function writeRunDbFixture(path: string): void {
  ensureParentDirectory(path);

  const workbook = XLSX.utils.book_new();
  const supportedRows: Array<[string, number, number, unknown[]]> = [
    ['5k(sorted', 1_200, EXCEL_DATE_2026_05_18, ['t', '*', 1]],
    ['10k(sorted)', 3_000, EXCEL_DATE_2026_05_18, [2]],
    ['12', 3_600, EXCEL_DATE_2026_05_18, []],
    ['Лист14', 7_200, EXCEL_DATE_2026_05_18, ['race-day-note']],
    ['M', 14_400, EXCEL_DATE_2026_05_18, []],
    ['Лист11', 1_500, EXCEL_DATE_2026_05_19, []],
    ['Лист13', 3_300, EXCEL_DATE_2026_05_19, []],
  ];

  for (const [sheetName, durationS, dateSerial, markers] of supportedRows) {
    const rows: unknown[][] = [
      ['Time', 'Date', 'Marker', 'PR', 'Rank'],
      [durationS / 86_400, dateSerial, ...markers],
    ];
    if (sheetName === '5k(sorted') rows.push([null, dateSerial, 't']);
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Time', 'Date'],
      [1_800 / 86_400, EXCEL_DATE_2026_05_18],
    ]),
    'Лист12',
  );
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['helper', 'value'], ['synthetic', 1]]), 'Helper');
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Time', 'Date'],
      [900 / 86_400, EXCEL_DATE_2026_05_18],
    ]),
    'Mystery Distance',
  );

  workbook.Workbook = {
    ...(workbook.Workbook ?? {}),
    Sheets: workbook.SheetNames.map((name) => ({ name, Hidden: name === 'Helper' ? 1 : 0 })),
  };

  XLSX.writeFile(workbook, path, { compression: true });
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function setCachedFormula(sheet: WorkSheet, address: string, formula: string, value: number): void {
  sheet[address] = { t: 'n', f: formula, v: value };
}
