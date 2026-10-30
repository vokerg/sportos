import { BadRequestException } from '@nestjs/common';
import { validateActivityMatchSummary, type ActivityMatchSummary, type GarminActivitySnapshot } from '@sportos/db';
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key)) || keys.some((key) => !(key in value))) {
    throw new BadRequestException({ code: 'INVALID_GARMIN_REQUEST', message: 'Unsupported Garmin request fields.' });
  }
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new BadRequestException('Garmin timestamps require an explicit UTC offset.');
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) throw new BadRequestException('Invalid Garmin timestamp.');
  const date = new Date(value);
  const calendar = value.slice(0, 10);
  if (!Number.isFinite(date.getTime()) || new Date(`${calendar}T00:00:00Z`).toISOString().slice(0, 10) !== calendar) throw new BadRequestException('Invalid Garmin timestamp.');
  return date;
}
export function parseGarminSnapshot(raw: unknown): GarminActivitySnapshot {
  const input = object(raw, ['providerActivityId', 'contentHash', 'origin', 'sourceUpdatedAt', 'summary']);
  const s = object(input.summary, ['activityType', 'subtype', 'startTime', 'elapsedTimeS', 'movingTimeS', 'distanceM']);
  const summary: ActivityMatchSummary = {
    activityType: s.activityType as ActivityMatchSummary['activityType'], subtype: s.subtype as ActivityMatchSummary['subtype'],
    startTime: timestamp(s.startTime), elapsedTimeS: s.elapsedTimeS as number | null, movingTimeS: s.movingTimeS as number | null, distanceM: s.distanceM as number | null,
  };
  try { validateActivityMatchSummary(summary); } catch { throw new BadRequestException('Invalid Garmin matching summary.'); }
  if ((input.providerActivityId !== null && (typeof input.providerActivityId !== 'string' || !/^[0-9]{1,20}$/.test(input.providerActivityId) || BigInt(input.providerActivityId) === 0n))
    || typeof input.contentHash !== 'string' || !/^[0-9a-f]{64}$/.test(input.contentHash) || !['archive', 'connect'].includes(String(input.origin))) throw new BadRequestException('Invalid Garmin source metadata.');
  return { provider: 'garmin', providerActivityId: input.providerActivityId as string | null, contentHash: input.contentHash,
    origin: input.origin as 'archive' | 'connect', sourceUpdatedAt: timestamp(input.sourceUpdatedAt), summary };
}

