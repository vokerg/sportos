import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { LEGACY_ACCOUNT_ID } from '@sportos/db';
import { CurrentAccount } from '../auth/current-account.decorator.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { parseDateRange } from '../query-validation.js';
import {
  DYNAMICS_METRICS,
  ROLLING_WINDOWS,
  type DynamicsGranularity,
  type DynamicsMetric,
  type DynamicsQuery,
  type RollingDynamicsQuery,
  type RollingWindow,
} from './dynamics.contracts.js';
import { DynamicsService } from './dynamics.service.js';

const QUERY_FIELDS = new Set(['from', 'to', 'granularity', 'metrics']);
const GRANULARITIES = new Set<DynamicsGranularity>(['daily', 'weekly', 'monthly']);
const ROLLING_QUERY_FIELDS = new Set(['from', 'to', 'metric', 'windows']);

@Controller('dynamics')
export class DynamicsController {
  constructor(@Inject(DynamicsService) private readonly dynamicsService: DynamicsService) {}

  @Get('monthly')
  monthly(@Query() raw: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    return this.dynamicsService.read(parseDynamicsQuery(raw), account?.id ?? LEGACY_ACCOUNT_ID);
  }

  @Get('rolling')
  rolling(@Query() raw: Record<string, unknown>, @CurrentAccount() account?: AuthenticatedAccount) {
    return this.dynamicsService.rolling(parseRollingDynamicsQuery(raw), account?.id ?? LEGACY_ACCOUNT_ID);
  }
}

export function parseDynamicsQuery(raw: Record<string, unknown>): DynamicsQuery {
  const unknownField = Object.keys(raw).find((field) => !QUERY_FIELDS.has(field));
  if (unknownField) invalid(`Unknown query field: ${unknownField}.`);
  const from = scalar(raw.from, 'from');
  const to = scalar(raw.to, 'to');
  const range = parseDateRange(from, to, { required: true, maxDays: 3660 });
  const granularity = scalar(raw.granularity, 'granularity') ?? 'monthly';
  if (!GRANULARITIES.has(granularity as DynamicsGranularity)) {
    invalid('granularity must be daily, weekly, or monthly.');
  }
  const metricsValue = scalar(raw.metrics, 'metrics') ?? 'score,steps,run';
  const metrics = metricsValue.split(',').map((metric) => metric.trim()).filter(Boolean);
  if (metrics.length === 0 || metrics.length > DYNAMICS_METRICS.length || new Set(metrics).size !== metrics.length) {
    invalid(`metrics must contain 1 through ${DYNAMICS_METRICS.length} unique values.`);
  }
  const unknownMetric = metrics.find((metric) => !DYNAMICS_METRICS.includes(metric as DynamicsMetric));
  if (unknownMetric) invalid(`Unknown metric: ${unknownMetric}.`);

  return {
    from: range.from!,
    to: range.to!,
    granularity: granularity as DynamicsGranularity,
    metrics: metrics as DynamicsMetric[],
  };
}

export function parseRollingDynamicsQuery(raw: Record<string, unknown>): RollingDynamicsQuery {
  const unknownField = Object.keys(raw).find((field) => !ROLLING_QUERY_FIELDS.has(field));
  if (unknownField) invalid(`Unknown query field: ${unknownField}.`);
  const from = scalar(raw.from, 'from');
  const to = scalar(raw.to, 'to');
  const range = parseDateRange(from, to, { required: true, maxDays: 3660 });
  const metric = scalar(raw.metric, 'metric') ?? 'score';
  if (!DYNAMICS_METRICS.includes(metric as DynamicsMetric)) invalid(`Unknown metric: ${metric}.`);
  const windowValues = (scalar(raw.windows, 'windows') ?? '30,365').split(',').map(Number);
  if (
    windowValues.length === 0
    || windowValues.length > ROLLING_WINDOWS.length
    || new Set(windowValues).size !== windowValues.length
    || windowValues.some((window) => !ROLLING_WINDOWS.includes(window as RollingWindow))
  ) invalid(`windows must contain unique values from ${ROLLING_WINDOWS.join(', ')}.`);

  return {
    from: range.from!,
    to: range.to!,
    metric: metric as DynamicsMetric,
    windows: windowValues as RollingWindow[],
  };
}

function scalar(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') invalid(`${field} must be supplied once.`);
  return value as string;
}

function invalid(message: string): never {
  throw new BadRequestException({ code: 'INVALID_DYNAMICS_QUERY', message });
}
