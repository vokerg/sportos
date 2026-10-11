import { sql } from 'kysely';
import type { Activity } from '../schema.js';

/** Presentation only: never use this expression as a scoring input. Current
 * compact Garmin metadata classifies existing links without a history rewrite. */
export function runClassification(alias: string) {
  const ref = (column: string) => sql.ref(`${alias}.${column}`);
  return sql<{ subtype: Activity['subtype']; source: 'garmin' } | null>`
    case when ${ref('activity_type')} = 'run'
      and (${ref('subtype')} in ('outdoor', 'unknown') or ${ref('subtype')} is null)
      and ${ref('source')} = 'strava'
    then (select jsonb_build_object('subtype', g.subtype, 'source', 'garmin')
      from garmin_activity_identities g
      where g.owner_id = ${ref('owner_id')} and g.activity_id = ${ref('id')}
        and g.activity_type = 'run' and g.subtype in ('outdoor', 'track', 'treadmill'))
    else null end`;
}

export function displaySubtype(alias: string) {
  return sql<Activity['subtype']>`coalesce((${runClassification(alias)})->>'subtype', ${sql.ref(`${alias}.subtype`)})`;
}
