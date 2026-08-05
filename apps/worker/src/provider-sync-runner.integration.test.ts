import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDb,
  ImportsRepository,
  LEGACY_ACCOUNT_ID,
  ProvidersRepository,
  WorkerDispatchRepository,
  withAccountContext,
} from '@sportos/db';
import {
  CredentialCipher,
  parseCredentialKeyRing,
  type ActivityPage,
  type ActivityPageRequest,
  type ActivityRequest,
  type AuthorizationCodeExchange,
  type AuthorizationRequest,
  type ProviderActivity,
  type ProviderAdapter,
  type ProviderAuthorization,
} from '@sportos/importers';
import { ProviderSyncRunner } from './provider-sync-runner.js';

const dispatchDatabaseUrl = process.env.SPORTOS_TEST_DATABASE_URL;
const dataDatabaseUrl = process.env.SPORTOS_WORKER_DATA_DATABASE_URL;
const databaseDescribe = dispatchDatabaseUrl && dataDatabaseUrl ? describe : describe.skip;
type TestDatabase = ReturnType<typeof createDb>;

const connectionId = '44444444-4444-4444-8444-444444444444';
const workbookActivityId = '55555555-5555-4555-8555-555555555555';
const workbookHash = 'a'.repeat(64);
const authorization: ProviderAuthorization = {
  providerAccountId: 'athlete-42',
  displayName: 'Integration Athlete',
  accessToken: 'old-access',
  refreshToken: 'old-refresh',
  expiresAt: new Date(Date.now() + 30_000),
  scopes: ['activity:read_all', 'read'],
};

const workbookOverlap: ProviderActivity = {
  providerActivityId: '1001',
  providerUpdatedAt: new Date('2026-08-03T10:00:00Z'),
  name: 'Workbook overlap',
  type: 'Run',
  sportType: 'Run',
  startDate: new Date('2026-08-03T06:00:00Z'),
  localDate: '2026-08-03',
  timezone: 'Europe/Copenhagen',
  distanceM: 10_000,
  elapsedTimeS: 3600,
  movingTimeS: 3500,
  elevationGainM: 100,
  averageHeartrate: 145,
  maxHeartrate: 170,
  averageSpeedMps: 2.857,
  calories: 700,
  isManual: false,
  isIndoor: false,
  isPrivate: false,
  isRace: false,
  raw: { id: 1001, type: 'Run', distance: 10_000 },
};

const providerOnly: ProviderActivity = {
  ...workbookOverlap,
  providerActivityId: '1002',
  name: 'Provider-only race',
  startDate: new Date('2026-08-04T06:00:00Z'),
  localDate: '2026-08-04',
  distanceM: 5000,
  elapsedTimeS: 1500,
  movingTimeS: 1450,
  isRace: true,
  raw: { id: 1002, type: 'Run', distance: 5000 },
};

class FakeStravaAdapter implements ProviderAdapter {
  readonly provider = 'strava' as const;
  refreshes = 0;
  pageRequests: number[] = [];

  constructor(private readonly retryAtAfterFirstPage: Date | null = null) {}

  createAuthorizationUrl(_input: AuthorizationRequest): URL { return new URL('https://example.test/authorize'); }
  async exchangeAuthorizationCode(_input: AuthorizationCodeExchange): Promise<ProviderAuthorization> { return authorization; }
  async refreshAuthorization(input: ProviderAuthorization): Promise<ProviderAuthorization> {
    this.refreshes += 1;
    return { ...input, accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: new Date(Date.now() + 60 * 60 * 1000) };
  }
  async revokeAuthorization(_input: ProviderAuthorization): Promise<void> {}
  async fetchActivityPage(input: ActivityPageRequest): Promise<ActivityPage> {
    this.pageRequests.push(input.page);
    return input.page === 1
      ? {
          activities: [workbookOverlap, providerOnly],
          rawActivities: [workbookOverlap.raw, providerOnly.raw],
          rateLimit: {
            shortLimit: 100,
            shortUsage: this.retryAtAfterFirstPage ? 100 : 2,
            dailyLimit: 1000,
            dailyUsage: 2,
            retryAt: this.retryAtAfterFirstPage,
          },
        }
      : {
          activities: [],
          rawActivities: [],
          rateLimit: { shortLimit: 100, shortUsage: 3, dailyLimit: 1000, dailyUsage: 3, retryAt: null },
        };
  }
  async fetchActivity(_input: ActivityRequest): Promise<ProviderActivity | null> { return null; }
}

databaseDescribe('ProviderSyncRunner database integration', () => {
  let dispatchDb: TestDatabase;
  let dataDb: TestDatabase;
  let cipher: CredentialCipher;

  beforeAll(async () => {
    dispatchDb = createDb(requireDatabaseUrl(dispatchDatabaseUrl, 'SPORTOS_TEST_DATABASE_URL'));
    dataDb = createDb(requireDatabaseUrl(dataDatabaseUrl, 'SPORTOS_WORKER_DATA_DATABASE_URL'));
    cipher = new CredentialCipher(parseCredentialKeyRing(`test:${randomBytes(32).toString('base64')}`, 'test'));
  });

  beforeEach(async () => {
    await resetProviderTables(dataDb);
  });

  afterAll(async () => {
    if (dataDb) await resetProviderTables(dataDb);
    await Promise.all([dispatchDb?.destroy(), dataDb?.destroy()]);
  });

  it('refreshes credentials, paginates, preserves workbook provenance, and converges on repeated delivery', async () => {
    const adapter = new FakeStravaAdapter();
    const firstJobId = await seedConnectionAndJob(dataDb, cipher);
    const runner = new ProviderSyncRunner(dispatchDb, dataDb, adapter, cipher, { workerId: 'provider-integration', leaseSeconds: 60, pageSize: 200 });
    const dispatch = new WorkerDispatchRepository(dispatchDb);

    const firstClaim = await dispatch.claimProviderSync('provider-integration', 60);
    expect(firstClaim).toMatchObject({ id: firstJobId, ownerId: LEGACY_ACCOUNT_ID, connectionId });
    await runner.process(firstClaim!);

    const firstEvidence = await readEvidence(dataDb, firstJobId, cipher);
    expect(firstEvidence.job).toMatchObject({ status: 'succeeded', phase: 'completed', attemptCount: 1, batchId: expect.any(String) });
    expect(firstEvidence.job.result).toMatchObject({ rawRecords: 2, activities: 2, performanceEvents: 1, warnings: 0 });
    expect(firstEvidence.activities).toHaveLength(2);
    expect(firstEvidence.workbook).toMatchObject({
      id: workbookActivityId,
      source: 'my_sport_xlsx',
      source_record_id: expect.any(String),
      source_activity_id: null,
      source_record_hash: workbookHash,
      notes: 'Original workbook provenance',
    });
    expect(firstEvidence.provider).toMatchObject({ source: 'strava', source_activity_id: '1002' });
    expect(firstEvidence.links).toHaveLength(2);
    expect(firstEvidence.sourceRecords).toHaveLength(3);
    expect(firstEvidence.decrypted.refreshToken).toBe('new-refresh');
    expect(adapter.refreshes).toBe(1);
    expect(adapter.pageRequests).toEqual([1, 2]);

    const secondJob = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, (db) => new ProvidersRepository(db).enqueueSync({ connectionId, mode: 'incremental' }));
    const secondClaim = await dispatch.claimProviderSync('provider-integration', 60);
    await runner.process(secondClaim!);
    const secondEvidence = await readEvidence(dataDb, secondJob.id, cipher);
    expect(secondEvidence.job.status).toBe('succeeded');
    expect(secondEvidence.activities).toHaveLength(2);
    expect(secondEvidence.links).toHaveLength(2);
    expect(secondEvidence.sourceRecords).toHaveLength(5);

    expect(await dispatchDb.selectFrom('provider_credentials').select('connection_id').execute()).toEqual([]);
    expect(await dispatchDb.selectFrom('activities').select('id').execute()).toEqual([]);
  });

  it('commits the page cursor and reschedules without consuming an attempt at a published rate limit', async () => {
    const retryAt = new Date(Date.now() + 60_000);
    const adapter = new FakeStravaAdapter(retryAt);
    const jobId = await seedConnectionAndJob(dataDb, cipher);
    const runner = new ProviderSyncRunner(dispatchDb, dataDb, adapter, cipher, { workerId: 'provider-rate-limit', leaseSeconds: 60, pageSize: 200 });
    const dispatch = new WorkerDispatchRepository(dispatchDb);

    const claim = await dispatch.claimProviderSync('provider-rate-limit', 60);
    expect(claim).toMatchObject({ id: jobId, ownerId: LEGACY_ACCOUNT_ID, connectionId });
    await runner.process(claim!);

    const evidence = await withAccountContext(dataDb, LEGACY_ACCOUNT_ID, async (ownerDb) => {
      const jobRow = await ownerDb.selectFrom('provider_sync_jobs')
        .select(['status', 'phase', 'attempt_count', 'next_attempt_at', 'cursor_json', 'import_batch_id'])
        .where('id', '=', jobId)
        .executeTakeFirstOrThrow();
      const sourceCount = await ownerDb.selectFrom('source_records')
        .select((eb) => eb.fn.countAll<number>().as('count'))
        .where('source', '=', 'strava_api')
        .executeTakeFirstOrThrow();
      return { jobRow, sourceCount: Number(sourceCount.count) };
    });

    expect(evidence.jobRow).toMatchObject({
      status: 'queued',
      phase: 'rate-limited',
      attempt_count: 0,
      import_batch_id: expect.any(String),
      cursor_json: {
        page: 2,
        rawCount: 2,
        activityCount: 2,
        performanceCount: 1,
        warningCount: 0,
      },
    });
    expect(new Date(evidence.jobRow.next_attempt_at).getTime()).toBe(retryAt.getTime());
    expect(evidence.sourceCount).toBe(2);
    await expect(dispatch.claimProviderSync('provider-rate-limit', 60)).resolves.toBeNull();
  });
});

async function seedConnectionAndJob(db: TestDatabase, credentialCipher: CredentialCipher): Promise<string> {
  return withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    const workbookBatch = await new ImportsRepository(ownerDb).createBatch({
      source: 'my_sport_xlsx',
      sourceKind: 'xlsx',
      metadata: { fixture: 'provider-overlap' },
    });
    const workbookSource = await ownerDb.insertInto('source_records').values({
      import_batch_id: workbookBatch.id,
      source: 'my_sport_xlsx',
      sheet_name: 'Activities',
      row_index: 2,
      source_record_key: 'activities:2',
      row_hash: workbookHash,
      raw_json: { Date: '2026-08-03', Type: 'Run', DistanceM: 10_000, MovingTimeS: 3500 },
      normalized_entity_type: 'activity',
      normalized_entity_id: workbookActivityId,
      status: 'normalized',
      errors: [],
      warnings: [],
    }).returning('id').executeTakeFirstOrThrow();
    await ownerDb.insertInto('activities').values({
      id: workbookActivityId,
      source: 'my_sport_xlsx',
      source_record_id: workbookSource.id,
      source_activity_id: null,
      source_record_hash: workbookHash,
      activity_date: '2026-08-03',
      start_time: workbookOverlap.startDate,
      activity_type: 'run',
      subtype: 'outdoor',
      distance_m: workbookOverlap.distanceM,
      duration_s: workbookOverlap.elapsedTimeS,
      moving_time_s: workbookOverlap.movingTimeS,
      steps: null,
      calories: null,
      avg_hr: null,
      max_hr: null,
      elevation_gain_m: null,
      avg_speed_mps: null,
      avg_pace_s_per_km: null,
      effort_points: null,
      notes: 'Original workbook provenance',
      raw_payload_json: {},
    }).execute();
    await ownerDb.insertInto('provider_connections').values({
      id: connectionId,
      provider: 'strava',
      provider_account_id: authorization.providerAccountId,
      display_name: authorization.displayName,
      scopes: authorization.scopes,
      status: 'connected',
      access_expires_at: authorization.expiresAt,
      cursor_json: {},
      last_sync_at: null,
      last_attempt_at: null,
      last_error_code: null,
      last_error_message: null,
      disconnected_at: null,
      revoked_at: null,
    }).execute();
    const envelope = credentialCipher.encrypt(connectionId, LEGACY_ACCOUNT_ID, 'strava', authorization);
    await ownerDb.insertInto('provider_credentials').values({
      connection_id: connectionId,
      key_id: envelope.keyId,
      algorithm: envelope.algorithm,
      nonce: envelope.nonce,
      ciphertext: envelope.ciphertext,
      authentication_tag: envelope.authenticationTag,
      envelope_version: envelope.envelopeVersion,
    }).execute();
    return (await new ProvidersRepository(ownerDb).enqueueSync({ connectionId, mode: 'initial_backfill' })).id;
  });
}

async function readEvidence(db: TestDatabase, jobId: string, credentialCipher: CredentialCipher) {
  return withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    const repository = new ProvidersRepository(ownerDb);
    const job = await repository.getSyncJob(jobId);
    const activities = await ownerDb.selectFrom('activities').selectAll().orderBy('activity_date').execute();
    const workbook = activities.find((activity) => activity.id === workbookActivityId);
    const provider = activities.find((activity) => activity.source === 'strava');
    const links = await ownerDb.selectFrom('provider_activity_links').selectAll().orderBy('provider_activity_id').execute();
    const sourceRecords = await ownerDb.selectFrom('source_records').selectAll().orderBy('created_at').execute();
    const stored = await repository.loadWorkerAuthorization(connectionId);
    const decrypted = credentialCipher.decrypt(connectionId, LEGACY_ACCOUNT_ID, 'strava', {
      keyId: stored!.credential.key_id,
      algorithm: stored!.credential.algorithm,
      nonce: stored!.credential.nonce,
      ciphertext: stored!.credential.ciphertext,
      authenticationTag: stored!.credential.authentication_tag,
      envelopeVersion: stored!.credential.envelope_version,
    });
    return { job: job!, activities, workbook, provider, links, sourceRecords, decrypted };
  });
}

async function resetProviderTables(db: TestDatabase): Promise<void> {
  await withAccountContext(db, LEGACY_ACCOUNT_ID, async (ownerDb) => {
    await ownerDb.deleteFrom('provider_activity_links').execute();
    await ownerDb.deleteFrom('provider_sync_jobs').execute();
    await ownerDb.deleteFrom('provider_credentials').execute();
    await ownerDb.deleteFrom('provider_connections').execute();
    await ownerDb.deleteFrom('performance_events').execute();
    await ownerDb.deleteFrom('activities').execute();
    await ownerDb.deleteFrom('source_records').execute();
    await ownerDb.deleteFrom('import_batches').execute();
  });
}

function requireDatabaseUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required for database integration tests.`);
  const databaseName = new URL(value).pathname.replace(/^\//, '');
  if (databaseName !== 'test' && !/[_-]test$/i.test(databaseName)) throw new Error(`${name} must target a test database.`);
  return value;
}
