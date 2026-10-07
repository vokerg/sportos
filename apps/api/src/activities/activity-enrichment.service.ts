import { BadRequestException, ConflictException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ActivitiesRepository, GarminActivityResourcesRepository, LEGACY_ACCOUNT_ID } from '@sportos/db';
import { matchGarminActivity, type ActivityMatchSummary } from '@sportos/domain';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthService } from '../auth/auth.service.js';
import type { AuthenticatedAccount } from '../auth/auth.models.js';
import { DbProvider, ActivityDetailDbProvider } from '../db.provider.js';
import { UploadStorage } from '../storage/upload-storage.js';
import { ActivityProviderDetailService } from './activity-provider-detail.service.js';
import { GarminLocalIngestService, type LocalGarminBundle } from './garmin-local-ingest.service.js';

@Injectable()
export class ActivityEnrichmentService {
  private readonly active = new Set<string>();
  constructor(private readonly primary: DbProvider, private readonly detail: ActivityDetailDbProvider,
    private readonly storage: UploadStorage, private readonly auth: AuthService,
    private readonly strava: ActivityProviderDetailService) {}

  localEnabled(accountId: string) {
    return this.auth.isDevelopmentMode() && accountId === LEGACY_ACCOUNT_ID && process.env.SPORTOS_GARMIN_LOCAL_FETCH_ENABLED === 'true';
  }
  async reference(accountId: string, activityId: string) {
    const activity = await this.primary.withAccount(accountId, db => new ActivitiesRepository(db).get(activityId));
    if (!activity) throw new NotFoundException('Activity was not found.');
    const garmin = await this.primary.withAccount(accountId, db => db.selectFrom('garmin_activity_identities')
      .select(['identity_key', 'current_hash', 'status']).where('activity_id', '=', activityId).executeTakeFirst());
    return { activity, garmin };
  }
  async status(accountId: string, activityId: string) {
    const { garmin } = await this.reference(accountId, activityId);
    const retained = garmin ? await this.detail.withAccount(accountId, async db => {
      const repo = new GarminActivityResourcesRepository(db); const ref = { identityKey: garmin.identity_key, sourceHash: garmin.current_hash };
      const [coverage, expected] = await Promise.all([repo.coverage(ref), repo.expectedResources(ref)]);
      return Array.isArray(expected) && expected.length >= 3 && expected.length <= 100 && expected.every(item => item && typeof item === 'object' && !Array.isArray(item) && coverage.some(row => row.resourceType === item.resourceType && row.chunkIndex === item.chunkIndex));
    }) : false;
    return { strava: await this.strava.status(accountId, activityId), garmin: {
      state: retained ? 'cached' : garmin ? 'linked' : 'missing',
      linked: Boolean(garmin), fetchEnabled: this.localEnabled(accountId),
    } };
  }
  async read(accountId: string, activityId: string) {
    const { garmin } = await this.reference(accountId, activityId);
    if (!garmin) throw new NotFoundException('Garmin detail is not retained for this activity.');
    return this.detail.withAccount(accountId, async db => {
      const repo = new GarminActivityResourcesRepository(db);
      const ref = { identityKey: garmin.identity_key, sourceHash: garmin.current_hash };
      const coverage = await repo.coverage(ref);
      if (!coverage.length) throw new NotFoundException('Garmin detail is not retained for this activity.');
      const [sessions, laps, sets] = await Promise.all([repo.messages(ref, 'session', 1), repo.messages(ref, 'lap', 100), repo.read(ref, 'sets')]);
      return { provider: 'garmin', sessions, laps, sets: sets?.payload ?? null,
        resources: coverage.filter(r => r.resourceType !== 'fit_manifest').map(r => ({ resourceType: r.resourceType, chunkIndex: r.chunkIndex })),
        retainedAt: coverage.reduce((last, row) => row.retainedAt > last ? row.retainedAt : last, coverage[0]!.retainedAt).toISOString() };
    });
  }
  async resource(accountId: string, activityId: string, type: string, chunk: number) {
    if (!['detail','sets','records','laps'].includes(type) || !Number.isInteger(chunk) || chunk < 0 || chunk > 10000) throw new BadRequestException('Invalid Garmin resource.');
    const { garmin } = await this.reference(accountId, activityId);
    if (!garmin) throw new NotFoundException('Garmin resource was not found.');
    const row = await this.detail.withAccount(accountId, db => new GarminActivityResourcesRepository(db).read({ identityKey: garmin.identity_key, sourceHash: garmin.current_hash }, type as 'detail', chunk));
    if (!row) throw new NotFoundException('Garmin resource was not found.');
    // Detail retention contains a private cache hash; expose only provider content.
    if (type === 'detail' && row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)) return { payload: { metadata: row.payload.metadata ?? null, details: row.payload.details ?? null } };
    return row;
  }

  async fetch(account: AuthenticatedAccount, activityId: string, refresh: boolean) {
    const key = `${account.id}:${activityId}`;
    if (this.active.has(key)) throw new ConflictException({ code: 'GARMIN_FETCH_IN_PROGRESS', message: 'Garmin fetch is already running for this activity.' });
    if (this.active.size >= 2) throw new HttpException({ code: 'GARMIN_FETCH_BUSY', message: 'Two Garmin requests are already active. Retry after they finish.' }, 429);
    this.active.add(key);
    try {
      const { activity: canonical, garmin } = await this.reference(account.id, activityId);
      const activity = canonical as typeof canonical & Record<string, unknown>;
      const retention = new GarminLocalIngestService(this.primary, this.detail, this.storage);
      if (!refresh && garmin && await retention.cachedBundle(garmin.identity_key, garmin.current_hash, account)) {
        return { ...(await this.read(account.id, activityId)), cacheStatus: 'hit' };
      }
      if (!this.localEnabled(account.id)) throw new ServiceUnavailableException({ code: 'GARMIN_LOCAL_FETCH_DISABLED', message: 'Garmin downloads require the enabled local desktop helper. Retained data can still be viewed.' });
      if (!activity.start_time || !['run','bike','swim','workout','rowing','sup'].includes(String(activity.activity_type))) throw new ConflictException({ code: 'GARMIN_MATCH_REQUIRES_REVIEW', message: 'This activity lacks supported matching metadata.' });
      const summary: ActivityMatchSummary = { activityType: activity.activity_type as ActivityMatchSummary['activityType'], subtype: (activity.subtype ?? 'unknown') as ActivityMatchSummary['subtype'], startTime: new Date(String(activity.start_time)), elapsedTimeS: activity.duration_s as number | null, movingTimeS: activity.moving_time_s as number | null, distanceM: activity.distance_m as number | null };
      let identifier = garmin?.identity_key.startsWith('native:') ? garmin.identity_key.slice(7) : null;
      if (!identifier) {
        const discovery = await this.bridge({ operation: 'discover', startTime: summary.startTime.toISOString() }) as { items: { providerActivityId: string; summary: Omit<ActivityMatchSummary,'startTime'> & { startTime: string } }[]; truncated: boolean; uncertain: boolean };
        if (!Array.isArray(discovery.items) || discovery.items.length > 100 || discovery.truncated || discovery.uncertain) throw new ConflictException({ code: 'GARMIN_MATCH_REQUIRES_REVIEW', message: 'Garmin candidates are incomplete or unsupported. No activity was selected.' });
        const result = matchGarminActivity(summary, discovery.items.map(item => ({ ...item.summary, startTime: new Date(item.summary.startTime), id: item.providerActivityId })));
        if (!result.activityId) throw new ConflictException({ code: result.status === 'ambiguous' ? 'GARMIN_MATCH_AMBIGUOUS' : 'GARMIN_ACTIVITY_NOT_FOUND', message: result.status === 'ambiguous' ? 'Multiple or uncertain Garmin candidates require review.' : 'No confident Garmin match was found.' });
        identifier = result.activityId;
      }
      const result = await this.bridge({ operation: 'extract', providerActivityId: identifier, refresh }) as { folder: string; bundle: { snapshot: { providerActivityId: string; contentHash: string; origin: string; sourceUpdatedAt: string; summary: Omit<ActivityMatchSummary,'startTime'> & { startTime: string } }; resources: { file: string; resourceType: string; chunkIndex: number }[]; original: { file: string }; files: { file: string; sha256: string; size: number }[] } };
      const bundle = result.bundle;
      if (!bundle || bundle.snapshot.providerActivityId !== identifier || !Array.isArray(bundle.files) || bundle.files.length > 100 || !Array.isArray(bundle.resources) || bundle.resources.length > 100) throw new BadRequestException('Invalid local Garmin bundle.');
      const check = matchGarminActivity({ ...bundle.snapshot.summary, startTime: new Date(bundle.snapshot.summary.startTime) }, [{ ...summary, id: activityId }]);
      if (check.activityId !== activityId) throw new ConflictException({ code: 'GARMIN_MATCH_REQUIRES_REVIEW', message: 'Downloaded Garmin metadata does not confidently match this activity.' });
      const linked = await retention.retainBundle(result as LocalGarminBundle, account);
      if (linked.activityId !== activityId) throw new ConflictException({ code: 'GARMIN_MATCH_REQUIRES_REVIEW', message: 'Garmin data was retained for review; no confident link to this activity was made.' });
      return { ...(await this.read(account.id, activityId)), cacheStatus: 'miss' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({ code: 'GARMIN_FETCH_FAILED', message: 'Garmin fetch failed. Check the local login and retry.' });
    } finally { this.active.delete(key); }
  }

  bridge(request: object, signal?: AbortSignal): Promise<unknown> {
    const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
    return new Promise((resolveResult, reject) => {
      const child = spawn(join(homedir(), '.local/share/sportos/garmin/venv/bin/python'), [join(repoRoot, 'tools/garmin/activity_bridge.py')], { stdio: ['pipe','pipe','ignore'], env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, PYTHONDONTWRITEBYTECODE: '1' } });
      const abort = () => { child.kill('SIGTERM'); reject(new ServiceUnavailableException({ code: 'GARMIN_FETCH_CANCELLED', message: 'Garmin fetch cancelled; retained evidence is safe.' })); };
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      let output = ''; const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new ServiceUnavailableException({ code: 'GARMIN_FETCH_TIMEOUT', message: 'Garmin fetch timed out. Retained data is safe; retry later.' })); }, 180_000);
      child.stdout.on('data', bytes => { output += String(bytes); if (Buffer.byteLength(output) > 100_000) { child.kill(); reject(new Error('Bounded bridge response exceeded')); } });
      child.once('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new ServiceUnavailableException({ code: 'GARMIN_LOCAL_SETUP_REQUIRED', message: 'Run pnpm garmin:setup and pnpm garmin:login locally first.' })); });
      child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); try { const result = JSON.parse(output); if (code !== 0 || result.error) {
        const known = ['GARMIN_RATE_LIMITED_RETRY_LATER','GARMIN_ACCESS_DENIED_REAUTHENTICATE','GARMIN_LOGIN_OR_FETCH_FAILED','GARMIN_LOGIN_FAILED_REAUTHENTICATE','RUN_PNPM_GARMIN_LOGIN_FIRST'];
        throw new ServiceUnavailableException({ code: known.includes(result.error) ? result.error : 'GARMIN_FETCH_FAILED', message: result.error === 'GARMIN_RATE_LIMITED_RETRY_LATER' ? 'Garmin rate limited the request. Retry later.' : 'Garmin login or download failed. Run pnpm garmin:login locally if authorization expired.' });
      } resolveResult(result); } catch (error) { reject(error); } });
      child.stdin.on('error', () => undefined); child.stdin.end(JSON.stringify(request));
    });
  }
}
