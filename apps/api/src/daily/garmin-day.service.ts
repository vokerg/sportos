import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { GARMIN_DAY_CATEGORIES, GarminDayRepository, GarminDayResourcesRepository, type GarminDayCategory, type GarminDayState, type GarminDayAvailability, type Json } from '@sportos/db';
import { ActivityEnrichmentService } from '../activities/activity-enrichment.service.js';
import { GarminLocalIngestService, type LocalGarminBundle } from '../activities/garmin-local-ingest.service.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { ActivityDetailDbProvider, DbProvider } from '../db.provider.js';
import { UploadStorage } from '../storage/upload-storage.js';
import { projectGarminDay, publicGarminPayload, hasGarminDayEvidence, nonScoringGarminDayIdentities } from './garmin-day-projection.js';
const retryable = (state: string) => ['failed','authentication_required','rate_limited'].includes(state);
type CategoryResult = { category: GarminDayCategory; state: GarminDayState; sourceHash?: string; byteSize?: number };

@Injectable()
export class GarminDayService {
  private readonly active = new Set<string>();
  constructor(private readonly primary: DbProvider, private readonly detail: ActivityDetailDbProvider,
    private readonly storage: UploadStorage, private readonly enrichment: ActivityEnrichmentService) {}

  private rows(owner: string, date: string) {
    return this.primary.withAccount(owner, db => new GarminDayRepository(db).read(date));
  }
  private publish(owner: string, date: string, input: Parameters<GarminDayRepository['publish']>[1]) {
    return this.primary.withAccount(owner, db => new GarminDayRepository(db).publish(date, input));
  }
  async read(owner: string, date: string, result?: 'cached' | 'fetched') {
    const rows = await this.rows(owner, date);
    const categories = [];
    for (const category of GARMIN_DAY_CATEGORIES) {
      const row = rows.find(item => item.category === category);
      let projection = row?.projection_json ?? null;
      if (category === 'activities' && projection && typeof projection === 'object' && !Array.isArray(projection)) {
        const ids = Array.isArray(projection.identities) ? projection.identities.filter((id): id is string => typeof id === 'string').slice(0,20) : [];
        const attempt = row?.attempt_json;
        const excluded = attempt && typeof attempt === 'object' && !Array.isArray(attempt) && Array.isArray(attempt.excludedIdentities) ? attempt.excludedIdentities : [];
        // Known walking remains in original day evidence/all-day steps, but is
        // absent from activity coverage, linking status and failure warnings.
        const scoredIds = ids.filter(id => !excluded.includes(id));
        const identities = scoredIds.length ? await this.primary.withAccount(owner, db => db.selectFrom('garmin_activity_identities')
          .select(['identity_key','activity_id','status']).where('identity_key','in',scoredIds).limit(20).execute()) : [];
        const failures = attempt && typeof attempt === 'object' && !Array.isArray(attempt) && Array.isArray(attempt.failures) ? attempt.failures : [];
        projection = { count: scoredIds.length, complete: projection.complete ?? false, activities: scoredIds.map((key, index) => {
          const identity = identities.find(item => item.identity_key === key);
          const failure = failures.find(item => item && typeof item === 'object' && !Array.isArray(item) && item.identityKey === key);
          return { ordinal: index + 1, activityId: identity?.activity_id ?? null, reconciliation: identity?.status ?? 'staged',
            resourceState: failure && typeof failure === 'object' && !Array.isArray(failure) ? failure.state ?? 'failed' : 'retained' };
        }) };
      }
      const recorded = projection !== null && hasGarminDayEvidence(category, projection);
      categories.push({ category, state: row?.state === 'available' && !recorded ? 'not_recorded' : row?.state ?? 'missing', retainedState: row?.availability === 'available' && !recorded ? 'not_recorded' : row?.availability ?? null,
        retainedAt: row?.retrieved_at?.toISOString() ?? null, attemptedAt: row?.attempted_at.toISOString() ?? null,
        evidence: projection, resourceAvailable: Boolean(row?.source_hash) });
    }
    const partial = rows.some(row => retryable(row.state));
    return { date, origin: 'garmin_connect', evidenceOnly: true, fetchEnabled: this.enrichment.localEnabled(owner),
      state: !rows.length ? 'missing' : partial || rows.length < 8 ? 'partial' : 'current', result: result ?? null, categories };
  }

  async resource(owner: string, date: string, category: GarminDayCategory) {
    const row = (await this.rows(owner, date)).find(item => item.category === category);
    if (!row?.source_hash) throw new NotFoundException('Garmin day resource was not found.');
    const resource = await this.detail.withAccount(owner, db => new GarminDayResourcesRepository(db).read(date, category, row.source_hash!));
    if (!resource) throw new NotFoundException('Garmin day resource was not found.');
    return { category, payload: publicGarminPayload(resource.payload_json) };
  }

  async fetch(account: AuthenticatedAccount, date: string, refresh: boolean, signal?: AbortSignal) {
    const key = `${account.id}:${date}`;
    if (this.active.has(key)) throw new ConflictException({ code: 'GARMIN_FETCH_IN_PROGRESS', message: 'Garmin day fetch is already running.' });
    // The workstation token store is shared; serialize day workflows across dates.
    if (this.active.size) throw new ConflictException({ code: 'GARMIN_FETCH_BUSY', message: 'Another Garmin day fetch is running. Retry after it finishes.' });
    this.active.add(key);
    const cancellation = new AbortController();
    const abort = () => cancellation.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(abort, 600_000);
    try {
      let rows = await this.rows(account.id, date);
      const prior = rows.find(row => row.category === 'activities');
      const priorProjection = prior?.projection_json;
      const priorAttempt = prior?.attempt_json;
      // Repair only a fully discovered retained day whose recorded failures are
      // all explicitly known non-scoring walking entries. No provider call.
      if (prior?.state === 'failed' && prior.source_hash && priorProjection && typeof priorProjection === 'object'
        && !Array.isArray(priorProjection) && priorProjection.complete === true && priorAttempt && typeof priorAttempt === 'object'
        && !Array.isArray(priorAttempt) && Array.isArray(priorAttempt.failures) && priorAttempt.failures.length) {
        const resource = await this.detail.withAccount(account.id, db => new GarminDayResourcesRepository(db).read(date, 'activities', prior.source_hash!));
        const excludedIdentities = nonScoringGarminDayIdentities(resource?.payload_json ?? null);
        if (priorAttempt.failures.every(failure => failure && typeof failure === 'object' && !Array.isArray(failure)
          && failure.state === 'failed' && excludedIdentities.includes(String(failure.identityKey)))) {
          await this.publish(account.id, date, { category: 'activities', state: 'available', attemptedAt: new Date(),
            attempt: { failures: [], excludedIdentities } });
          rows = await this.rows(account.id, date);
        }
      }
      const retention = new GarminLocalIngestService(this.primary, this.detail, this.storage);
      const requested: GarminDayCategory[] = [];
      for (const category of GARMIN_DAY_CATEGORIES) {
        const row = rows.find(item => item.category === category);
        let complete = Boolean(row && !retryable(row.state));
        if (complete && row?.source_hash) complete = Boolean(await this.detail.withAccount(account.id, db => new GarminDayResourcesRepository(db).read(date, category, row.source_hash!)));
        if (complete && category === 'activities' && row?.projection_json && typeof row.projection_json === 'object' && !Array.isArray(row.projection_json) && Array.isArray(row.projection_json.identities)) {
          const attempt = row.attempt_json;
          const excluded = attempt && typeof attempt === 'object' && !Array.isArray(attempt) && Array.isArray(attempt.excludedIdentities) ? attempt.excludedIdentities : [];
          for (const key of row.projection_json.identities) {
            if (excluded.includes(key)) continue;
            if (typeof key !== 'string') { complete = false; break; }
            const identity = await this.primary.withAccount(account.id, db => db.selectFrom('garmin_activity_identities').select(['current_hash']).where('identity_key','=',key).executeTakeFirst());
            if (!identity || !await retention.cachedBundle(key, identity.current_hash, account)) { complete = false; break; }
          }
        }
        if (refresh || !complete) requested.push(category);
      }
      if (!requested.length) return this.read(account.id, date, 'cached');
      if (!this.enrichment.localEnabled(account.id)) throw new ServiceUnavailableException({ code: 'GARMIN_LOCAL_FETCH_DISABLED', message: 'Garmin downloads require the enabled local desktop helper. Retained evidence can still be viewed.' });
      this.checkCancelled(cancellation.signal);
      let results: CategoryResult[];
      try {
        const raw = await this.enrichment.bridge({ operation: 'day', date, categories: requested }, cancellation.signal);
        results = parseDayBundle(raw, date, requested);
      } catch (error) {
        const state = errorState(error);
        for (const category of requested) await this.publish(account.id, date, { category, state, attemptedAt: new Date() });
        if (cancellation.signal.aborted) throw error;
        return this.read(account.id, date, 'fetched');
      }
      for (const entry of results) {
        this.checkCancelled(cancellation.signal);
        const attemptedAt = new Date();
        if (!entry.sourceHash) {
          await this.publish(account.id, date, { category: entry.category, state: entry.state, attemptedAt });
          continue;
        }
        try {
          const payload = await this.localPayload(entry);
          // Immutable original JSON is committed to auxiliary storage first.
          await this.detail.withAccount(account.id, db => new GarminDayResourcesRepository(db).retain(date, entry.category, entry.sourceHash!, payload));
          const projection = entry.state === 'private' || (entry.state === 'not_recorded' && payload && typeof payload === 'object' && Object.keys(payload).length === 0) ? {} : projectGarminDay(entry.category, payload, date);
          let state = entry.state === 'available' && !hasGarminDayEvidence(entry.category, projection) ? 'not_recorded' as const : entry.state;
          let attempt: Json = {};
          if (entry.category === 'activities') {
            const ids = projection && typeof projection === 'object' && !Array.isArray(projection) && Array.isArray(projection.identities) ? projection.identities : [];
            const failures: Json[] = [];
            const excludedIdentities = nonScoringGarminDayIdentities(payload);
            for (const identityKey of ids) {
              this.checkCancelled(cancellation.signal);
              if (typeof identityKey !== 'string') throw new BadRequestException('Invalid Garmin identity.');
              if (excludedIdentities.includes(identityKey)) continue;
              try {
                const reference = await this.primary.withAccount(account.id, db => db.selectFrom('garmin_activity_identities')
                  .select(['identity_key','current_hash']).where('identity_key','=',identityKey).executeTakeFirst());
                if (!refresh && reference && await retention.cachedBundle(reference.identity_key, reference.current_hash, account)) continue;
                const bundle = await this.enrichment.bridge({ operation: 'extract', providerActivityId: identityKey.slice(7), refresh }, cancellation.signal) as LocalGarminBundle;
                if (bundle?.bundle?.snapshot?.providerActivityId !== identityKey.slice(7)) throw new BadRequestException('Invalid Garmin activity bundle.');
                await retention.retainBundle(bundle, account);
              } catch (error) {
                const failedState = errorState(error);
                failures.push({ identityKey, state: failedState });
                if (cancellation.signal.aborted) throw error;
                if (failedState === 'authentication_required' || failedState === 'rate_limited') {
                  for (const remaining of ids.slice(ids.indexOf(identityKey) + 1)) failures.push({ identityKey: remaining, state: failedState });
                  break;
                }
              }
            }
            attempt = { failures, ...(excludedIdentities.length ? { excludedIdentities } : {}) };
            const complete = projection && typeof projection === 'object' && !Array.isArray(projection) && projection.complete === true;
            if (failures.length || !complete) state = 'failed';
          }
          await this.publish(account.id, date, { category: entry.category, state, attemptedAt,
            version: { hash: entry.sourceHash, availability: entry.state as GarminDayAvailability, projection }, attempt });
        } catch (error) {
          if (cancellation.signal.aborted) throw error;
          await this.publish(account.id, date, { category: entry.category, state: errorState(error), attemptedAt });
        }
      }
      return this.read(account.id, date, 'fetched');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'GARMIN_DAY_RETENTION_UNAVAILABLE', message: 'Garmin day retention is unavailable. Prior evidence is safe; retry later.' });
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); this.active.delete(key); }
  }

  async localPayload(entry: CategoryResult): Promise<Json> {
    const root = join(homedir(), '.local/share/sportos/garmin/days');
    const folder = join(root, entry.sourceHash!);
    for (const path of [join(homedir(), '.local'), join(homedir(), '.local/share'), join(homedir(), '.local/share/sportos'), join(homedir(), '.local/share/sportos/garmin'), root, folder]) {
      const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new BadRequestException('Invalid local Garmin artifact directory.');
    }
    const path = join(folder, 'payload.json'); const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.byteSize || info.size > 4_000_000) throw new BadRequestException('Invalid local Garmin day artifact.');
    const data = await readFile(path);
    if (data.length !== entry.byteSize || createHash('sha256').update(data).digest('hex') !== entry.sourceHash) throw new BadRequestException('Invalid Garmin day content.');
    try { return JSON.parse(data.toString('utf8')) as Json; } catch { throw new BadRequestException('Invalid Garmin day JSON.'); }
  }
  private checkCancelled(signal: AbortSignal) {
    if (signal.aborted) throw new ServiceUnavailableException({ code: 'GARMIN_FETCH_CANCELLED', message: 'Garmin fetch cancelled or timed out. Prior evidence is safe; retry later.' });
  }
}

function errorState(error: unknown): GarminDayState {
  const response = error instanceof HttpException ? error.getResponse() : null;
  const code = response && typeof response === 'object' && 'code' in response ? String(response.code) : '';
  if (/RATE_LIMIT/.test(code)) return 'rate_limited';
  if (/REAUTHENTICATE|LOGIN|SETUP_REQUIRED/.test(code)) return 'authentication_required';
  return 'failed';
}
function parseDayBundle(raw: unknown, date: string, requested: GarminDayCategory[]): CategoryResult[] {
  const value = raw as { schema?: string; date?: string; categories?: CategoryResult[] } | null;
  if (!value || value.schema !== 'sportos.garmin-day.v1' || value.date !== date || !Array.isArray(value.categories) || value.categories.length !== requested.length
    || Object.keys(value).some(key => !['schema','date','categories'].includes(key))) throw new BadRequestException('Invalid Garmin day bundle.');
  const seen = new Set<string>();
  for (const entry of value.categories) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !['category','state','sourceHash','byteSize'].includes(key))
      || !requested.includes(entry.category) || seen.has(entry.category)
      || !['available','not_recorded','unsupported','private','failed','authentication_required','rate_limited'].includes(entry.state)) throw new BadRequestException('Invalid Garmin day category.');
    seen.add(entry.category);
    if (entry.sourceHash !== undefined) {
      if (typeof entry.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sourceHash) || !Number.isInteger(entry.byteSize) || entry.byteSize! < 1 || entry.byteSize! > 4_000_000 || retryable(entry.state)) throw new BadRequestException('Invalid Garmin day resource.');
    } else if (entry.byteSize !== undefined || ['available','not_recorded','private'].includes(entry.state)) throw new BadRequestException('Missing Garmin day source.');
  }
  return value.categories;
}
