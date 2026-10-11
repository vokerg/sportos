import type { Generated } from 'kysely';
import type { EffortMethod, EffortStatus, RunningEffort } from '@sportos/domain';
import type { OwnerId, GeneratedTimestamp } from './schema.js';
export interface RunningEffortProjectionsTable {
  id: Generated<string>; owner_id: OwnerId; activity_id: string; provider: 'strava' | 'garmin';
  source_ref: string; source_version: string; input_hash: string; resource_hash: string | null; algorithm_version: number; projected_at: GeneratedTimestamp;
}
export interface RunningEffortValuesTable {
  owner_id: OwnerId; activity_id: string; provider: 'strava' | 'garmin'; projection_id: string;
  target_distance_m: number; method: EffortMethod; status: EffortStatus; reason: string | null;
  duration_s: number | null; source_distance_m: number | null; coverage_distance_m: number | null;
  start_offset_s: number | null; end_offset_s: number | null;
  pause_policy: RunningEffort['pausePolicy']; pause_coverage: RunningEffort['pauseCoverage'];
}
export interface RunningEffortHeadsTable {
  owner_id: OwnerId; activity_id: string; provider: 'strava' | 'garmin'; source_ref: string; source_version: string;
  projection_id: string | null; expected_resource_hash: string | null; state: 'current' | 'stale' | 'failed';
  failure_category: 'retained_read_failed' | 'projection_failed' | null; inspected_at: GeneratedTimestamp;
}
