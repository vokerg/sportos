import type { Generated } from 'kysely';
import type { GeneratedTimestamp, OwnerId, Json } from './schema.js';
export interface PerformanceMatchDecisionsTable {
  id: Generated<string>; owner_id: OwnerId; event_id: string; activity_id: string | null;
  status: 'accepted' | 'ambiguous' | 'unmatched' | 'rejected'; method: 'automatic' | 'operator' | 'historical';
  policy_version: number; input_hash: string; reason: string; diagnostics: Json; created_at: GeneratedTimestamp;
}
export interface PerformanceMatchHeadsTable {
  owner_id: OwnerId; event_id: string; decision_id: string;
}
