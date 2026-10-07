import { createHash } from 'node:crypto';
import { type Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';
import type { GarminActivityResourcesTable } from '../garmin-activity-schema.js';
export interface GarminResourceReference { identityKey: string; sourceHash: string; }
export interface GarminResourceWrite {
  resourceType: GarminActivityResourcesTable['resource_type']; chunkIndex: number; payload: Json;
}
/** Construct with the separate detail database inside owner context. Original
 * FIT bytes remain in blob storage; fit_manifest contains only private references.
 * Callers retain resources before passing the compact snapshot to reconciliation.
 */
export class GarminActivityResourcesRepository {
  constructor(private readonly db: Kysely<Database>) {}
  async retain(reference: GarminResourceReference, resource: GarminResourceWrite): Promise<boolean> {
    validate(reference);
    if (!['detail', 'sets', 'laps', 'records', 'fit_manifest'].includes(resource.resourceType)
      || !Number.isInteger(resource.chunkIndex) || resource.chunkIndex < 0 || resource.chunkIndex > 10000) throw new Error('Invalid Garmin resource.');
    const serialized = JSON.stringify(resource.payload);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 4_000_000) throw new Error('Garmin resource must be bounded or chunked.');
    const hash = createHash('sha256').update(serialized).digest('hex');
    const result = await this.db.insertInto('garmin_activity_resources').values({ identity_key: reference.identityKey,
      source_hash: reference.sourceHash, resource_type: resource.resourceType, chunk_index: resource.chunkIndex,
      resource_hash: hash, payload_json: resource.payload,
    }).onConflict((oc) => oc.columns(['owner_id', 'identity_key', 'source_hash', 'resource_type', 'chunk_index']).doNothing()).returning('id').executeTakeFirst();
    if (!result) {
      const existing = await this.db.selectFrom('garmin_activity_resources').select('resource_hash')
        .where('identity_key', '=', reference.identityKey).where('source_hash', '=', reference.sourceHash)
        .where('resource_type', '=', resource.resourceType).where('chunk_index', '=', resource.chunkIndex).executeTakeFirstOrThrow();
      if (existing.resource_hash !== hash) throw new Error('Garmin resource version conflicts with retained content.');
    }
    return result !== undefined;
  }
  async coverage(reference: GarminResourceReference) {
    validate(reference);
    return this.db.selectFrom('garmin_activity_resources').select(['resource_type as resourceType', 'chunk_index as chunkIndex', 'created_at as retainedAt'])
      .where('identity_key', '=', reference.identityKey).where('source_hash', '=', reference.sourceHash).orderBy('resource_type').orderBy('chunk_index').limit(100).execute();
  }
  async read(reference: GarminResourceReference, resourceType: GarminResourceWrite['resourceType'], chunkIndex = 0) {
    validate(reference);
    const row = await this.db.selectFrom('garmin_activity_resources').select('payload_json')
      .where('identity_key', '=', reference.identityKey).where('source_hash', '=', reference.sourceHash)
      .where('resource_type', '=', resourceType).where('chunk_index', '=', chunkIndex).executeTakeFirst();
    return row ? { payload: row.payload_json } : null;
  }
}
function validate(r: GarminResourceReference) {
  if (!/^(native:[0-9]{1,20}|fingerprint:v1:[a-f0-9]{64})$/.test(r.identityKey) || !/^[a-f0-9]{64}$/.test(r.sourceHash)) throw new Error('Invalid Garmin resource reference.');
}
