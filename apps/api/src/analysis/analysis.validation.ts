import { BadRequestException } from '@nestjs/common';
import { isIsoDate } from '@sportos/db';
import { parseDateRange } from '../query-validation.js';
import type { AnalysisAnswerRequest, AnalysisToolRequest } from './analysis.contracts.js';

const TOOL_KEYS = new Set(['tool', 'input']);
const ANSWER_KEYS = new Set(['question', 'tool', 'input']);

export function parseAnalysisToolRequest(value: unknown): AnalysisToolRequest {
  const body = requireRecord(value, 'Request body must be an object.');
  assertOnlyKeys(body, TOOL_KEYS);
  return parseToolAndInput(body.tool, body.input);
}

export function parseAnalysisAnswerRequest(value: unknown): AnalysisAnswerRequest {
  const body = requireRecord(value, 'Request body must be an object.');
  assertOnlyKeys(body, ANSWER_KEYS);
  const question = requireString(body.question, 'question').trim();
  if (question.length === 0 || question.length > 500) {
    invalid('INVALID_ANALYSIS_QUESTION', 'question must contain from 1 through 500 characters.');
  }
  return {
    question,
    toolRequest: parseToolAndInput(body.tool, body.input),
  };
}

function parseToolAndInput(tool: unknown, rawInput: unknown): AnalysisToolRequest {
  if (tool === 'daily_summary') {
    const input = requireRecord(rawInput, 'daily_summary input must be an object.');
    assertOnlyKeys(input, new Set(['from', 'to', 'limit']));
    const from = requireString(input.from, 'from');
    const to = requireString(input.to, 'to');
    const range = parseDateRange(from, to, { required: true, maxDays: 366 });
    return {
      tool: 'daily_summary',
      input: {
        from: range.from!,
        to: range.to!,
        limit: parseInteger(input.limit, 'limit', 366, 1, 366),
      },
    };
  }

  if (tool === 'daily_score_breakdown') {
    const input = requireRecord(rawInput, 'daily_score_breakdown input must be an object.');
    assertOnlyKeys(input, new Set(['date']));
    const date = requireString(input.date, 'date');
    if (!isIsoDate(date)) {
      invalid('INVALID_ANALYSIS_DATE', 'date must be a real calendar date in YYYY-MM-DD format.');
    }
    return { tool: 'daily_score_breakdown', input: { date } };
  }

  invalid('UNSUPPORTED_ANALYSIS_TOOL', 'The requested analysis tool is not supported.');
}

function requireRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid('INVALID_ANALYSIS_TOOL_REQUEST', message);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    invalid('INVALID_ANALYSIS_TOOL_REQUEST', `${field} must be a non-empty string.`);
  }
  return value;
}

function parseInteger(value: unknown, field: string, defaultValue: number, min: number, max: number): number {
  const parsed = value === undefined ? defaultValue : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    invalid('INVALID_ANALYSIS_TOOL_REQUEST', `${field} must be an integer from ${min} through ${max}.`);
  }
  return parsed;
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    invalid('INVALID_ANALYSIS_TOOL_REQUEST', 'The request contains unsupported fields.');
  }
}

function invalid(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}
