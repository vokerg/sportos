import type { Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';

export const ACTIVITY_PROVIDER_RESOURCE_TYPES = ['detail', 'streams', 'laps', 'zones'] as const;
export type ActivityProviderResourceType = typeof ACTIVITY_PROVIDER_RESOURCE_TYPES[number];

export interface ActivityProviderReference {
  activityId: string;
  provider: 'strava';
  providerActivityId: string;
  connectionId: string;
  providerVersion: string;
}

export interface ActivityProviderResourceReadModel {
  resourceType: ActivityProviderResourceType;
  availability: 'available' | 'unavailable';
  httpStatus: number | null;
  providerVersion: string;
  fetchedAt: Date;
  payload: Json;
}

export interface ActivityProviderResourceWrite {
  resourceType: ActivityProviderResourceType;
  availability: 'available' | 'unavailable';
  httpStatus: number | null;
  payload: Json;
}

export class ActivityProviderResourcesRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async getProviderReference(activityId: string): Promise<ActivityProviderReference | null> {
    const row = await this.db.selectFrom('provider_activity_links as link')
      .innerJoin('provider_connections as connection', (join) => join
        .onRef('connection.owner_id', '=', 'link.owner_id')
        .onRef('connection.id', '=', 'link.connection_id'))
      .innerJoin('source_records as source', (join) => join
        .onRef('source.owner_id', '=', 'link.owner_id')
        .onRef('source.id', '=', 'link.latest_source_record_id'))
      .select([
        'link.activity_id as activityId',
        'connection.provider',
        'link.provider_activity_id as providerActivityId',
        'link.connection_id as connectionId',
        'source.row_hash as providerVersion',
      ])
      .where('link.activity_id', '=', activityId)
      .where('link.availability', '=', 'available')
      .where('connection.provider', '=', 'strava')
      .orderBy('link.updated_at', 'desc')
      .orderBy('link.id', 'desc')
      .executeTakeFirst();
    return row ?? null;
  }

  async list(reference: ActivityProviderReference): Promise<ActivityProviderResourceReadModel[]> {
    const rows = await this.db.selectFrom('activity_provider_resources')
      .select(['resource_type', 'availability', 'http_status', 'provider_version', 'fetched_at', 'payload_json'])
      .where('activity_id', '=', reference.activityId)
      .where('provider', '=', reference.provider)
      .where('provider_activity_id', '=', reference.providerActivityId)
      .orderBy('resource_type', 'asc')
      .execute();
    return rows.map((row) => ({
      resourceType: row.resource_type,
      availability: row.availability,
      httpStatus: row.http_status,
      providerVersion: row.provider_version,
      fetchedAt: row.fetched_at,
      payload: row.payload_json,
    }));
  }

  async replace(
    reference: ActivityProviderReference,
    resources: ActivityProviderResourceWrite[],
  ): Promise<void> {
    const fetchedAt = new Date();
    await this.db.transaction().execute(async (tx) => {
      for (const resource of resources) {
        await tx.insertInto('activity_provider_resources').values({
          activity_id: reference.activityId,
          provider: reference.provider,
          provider_activity_id: reference.providerActivityId,
          resource_type: resource.resourceType,
          availability: resource.availability,
          http_status: resource.httpStatus,
          provider_version: reference.providerVersion,
          fetched_at: fetchedAt,
          payload_json: resource.payload,
        }).onConflict((oc) => oc
          .columns(['owner_id', 'activity_id', 'provider', 'provider_activity_id', 'resource_type'])
          .doUpdateSet({
            availability: resource.availability,
            http_status: resource.httpStatus,
            provider_version: reference.providerVersion,
            fetched_at: fetchedAt,
            payload_json: resource.payload,
            updated_at: fetchedAt,
          }))
          .execute();
      }
    });
  }
}
