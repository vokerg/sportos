import type { Kysely } from 'kysely';
import type { Database, Json } from '../schema.js';

export const ACTIVITY_PROVIDER_RESOURCE_TYPES = ['detail', 'streams', 'laps', 'zones'] as const;
export type ActivityProviderResourceType = typeof ACTIVITY_PROVIDER_RESOURCE_TYPES[number];

export interface ActivityProviderReference {
  activityId: string;
  provider: 'strava';
  providerActivityId: string;
  connectionId: string;
  providerUpdatedAt: Date | null;
}

export interface ActivityProviderResourceReadModel {
  resourceType: ActivityProviderResourceType;
  availability: 'available' | 'unavailable';
  httpStatus: number | null;
  providerUpdatedAt: Date | null;
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
      .select([
        'link.activity_id as activityId',
        'connection.provider',
        'link.provider_activity_id as providerActivityId',
        'link.connection_id as connectionId',
        'link.provider_updated_at as providerUpdatedAt',
      ])
      .where('link.activity_id', '=', activityId)
      .where('link.availability', '=', 'available')
      .where('connection.status', '=', 'connected')
      .where('connection.provider', '=', 'strava')
      .executeTakeFirst();
    return row ?? null;
  }

  async list(activityId: string, provider: 'strava'): Promise<ActivityProviderResourceReadModel[]> {
    const rows = await this.db.selectFrom('activity_provider_resources')
      .select(['resource_type', 'availability', 'http_status', 'provider_updated_at', 'fetched_at', 'payload_json'])
      .where('activity_id', '=', activityId)
      .where('provider', '=', provider)
      .orderBy('resource_type', 'asc')
      .execute();
    return rows.map((row) => ({
      resourceType: row.resource_type,
      availability: row.availability,
      httpStatus: row.http_status,
      providerUpdatedAt: row.provider_updated_at,
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
          provider_updated_at: reference.providerUpdatedAt,
          fetched_at: fetchedAt,
          payload_json: resource.payload,
        }).onConflict((oc) => oc
          .columns(['owner_id', 'activity_id', 'provider', 'resource_type'])
          .doUpdateSet({
            provider_activity_id: reference.providerActivityId,
            availability: resource.availability,
            http_status: resource.httpStatus,
            provider_updated_at: reference.providerUpdatedAt,
            fetched_at: fetchedAt,
            payload_json: resource.payload,
            updated_at: fetchedAt,
          }))
          .execute();
      }
    });
  }
}
