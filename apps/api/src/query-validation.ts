import { BadRequestException } from '@nestjs/common';
import { isIsoDate } from '@sportos/db';

export interface ValidatedDateRange {
  from?: string;
  to?: string;
}

export function parseDateRange(
  from: string | undefined,
  to: string | undefined,
  options: { required?: boolean; maxDays?: number } = {},
): ValidatedDateRange {
  if (options.required && (!from || !to)) {
    throw new BadRequestException({
      code: 'DATE_RANGE_REQUIRED',
      message: 'Both from and to are required in YYYY-MM-DD format.',
    });
  }
  if (from !== undefined && !isIsoDate(from)) invalidDate('from', from);
  if (to !== undefined && !isIsoDate(to)) invalidDate('to', to);
  if (from && to && from > to) {
    throw new BadRequestException({
      code: 'INVALID_DATE_RANGE',
      message: 'from must be on or before to.',
      from,
      to,
    });
  }
  if (from && to && options.maxDays !== undefined) {
    const span = inclusiveSpan(from, to);
    if (span > options.maxDays) {
      throw new BadRequestException({
        code: 'DATE_RANGE_TOO_LARGE',
        message: `Date range must contain at most ${options.maxDays} days.`,
        from,
        to,
        maxDays: options.maxDays,
      });
    }
  }
  return { from, to };
}

export function parseBoundedInteger(
  value: string | undefined,
  options: { name: string; defaultValue: number; min: number; max: number },
): number {
  const parsed = value === undefined ? options.defaultValue : Number(value);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new BadRequestException({
      code: `INVALID_${options.name.toUpperCase()}`,
      message: `${options.name} must be an integer from ${options.min} through ${options.max}.`,
    });
  }
  return parsed;
}

export function parseOptionalPositiveNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new BadRequestException({
      code: `INVALID_${name.toUpperCase()}`,
      message: `${name} must be a positive number.`,
    });
  }
  return parsed;
}

export function assertUuid(value: string, code: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException({ code, message: 'Identifier must be a UUID.' });
  }
}

function invalidDate(field: string, value: string): never {
  throw new BadRequestException({
    code: 'INVALID_DATE',
    message: `${field} must be a real calendar date in YYYY-MM-DD format.`,
    field,
    value,
  });
}

function inclusiveSpan(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000) + 1;
}
