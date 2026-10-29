import { parseSwimLengths, unavailableSwimLengths } from '@sportos/domain';
import type { Kysely } from 'kysely';
import type { Database } from '../schema.js';
import { GarminActivityResourcesRepository } from './garmin-activity-resources.repository.js';
export function unavailableAthleteSwimLengths(
  reason: string,
  input: { limit: number; offset: number },
) {
  return {
    ...unavailableSwimLengths(reason),
    lengths: [],
    total: 0,
    limit: input.limit,
    offset: input.offset,
    hasMore: false,
    canonicalCorrectionApplied: false as const,
  };
}
export async function retainedAthleteSwimLengths(
  db: Kysely<Database>,
  garmin: { identity_key: string; current_hash: string } | undefined,
  input: { limit: number; offset: number },
) {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100 ||
    !Number.isInteger(input.offset) ||
    input.offset < 0 ||
    input.offset > 2000
  )
    throw Error('Invalid swim length page.');
  if (!garmin) return unavailableAthleteSwimLengths('no_current_garmin_reference', input);
  const repo = new GarminActivityResourcesRepository(db),
    reference = { identityKey: garmin.identity_key, sourceHash: garmin.current_hash };
  const [sessions, messages] = await Promise.all([
    repo.messages(reference, 'session', 1),
    repo.swimLengthMessages(reference, 2001),
  ]);
  const parsed = parseSwimLengths(sessions[0], messages.slice(0, 2000), messages.length > 2000);
  const allowed = new Set([
    'freestyle',
    'backstroke',
    'breaststroke',
    'butterfly',
    'drill',
    'mixed',
    'individual medley',
  ]);
  const lengths = parsed.lengths
    .slice(input.offset, input.offset + input.limit)
    .map((row) => ({ ...row, stroke: row.stroke && allowed.has(row.stroke) ? row.stroke : null }));
  return {
    ...parsed,
    lengths,
    total: parsed.lengths.length,
    limit: input.limit,
    offset: input.offset,
    hasMore: input.offset + lengths.length < parsed.lengths.length,
    canonicalCorrectionApplied: false as const,
  };
}
