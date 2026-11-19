/** Explicit client workflow over existing account-scoped durable queues. No scoring or provider access. */
export type SyncStage = 'strava' | 'garmin' | 'calculation';
export interface SyncJob { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' }
export interface SyncView { stage: SyncStage; status: 'idle' | 'running' | 'paused' | 'error' | 'done'; message: string }
export interface SyncTransport {
  signal: AbortSignal;
  read(path: string): Promise<unknown>;
  post(path: string, body: object): Promise<unknown>;
  watch(initial: SyncJob, read: () => Promise<SyncJob>, report: (job: SyncJob) => void): Promise<SyncJob | null>;
}
const stages: SyncStage[] = ['strava', 'garmin', 'calculation'];
const labels = { strava: 'Strava import', garmin: 'Garmin sync', calculation: 'Score calculation' };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const activeSyncJob = (job: SyncJob) => job.status === 'queued' || job.status === 'running';
function record(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid response');
  return raw as Record<string, unknown>;
}
function identifier(raw: unknown): string {
  if (typeof raw !== 'string' || !uuid.test(raw)) throw new Error('Invalid identifier');
  return raw;
}
export function parseSyncJob(raw: unknown): SyncJob {
  const value = record(raw);
  if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(String(value.status))) throw new Error('Invalid status');
  return { id: identifier(value.id), status: value.status as SyncJob['status'] };
}
export function syncButtonLabel(view: SyncView): string {
  if (view.status === 'running') return labels[view.stage] + '…';
  if (view.status === 'paused' || view.status === 'error') return 'Continue update';
  return 'Update everything';
}
class WorkflowProblem extends Error {}

/** Screen-memory checkpoint. Repeated clicks coalesce; a paused run watches the exact same job. */
export class SyncEverything {
  view: SyncView = { stage: 'strava', status: 'idle', message: 'Strava → Garmin → Recalculate' };
  private locked = false;
  private job: SyncJob | null = null;
  private jobPrefix = '';
  private prerequisiteJob = false;
  private pending: { baseline: string | null } | null = null;

  async run(api: SyncTransport, changed: (view: SyncView) => void): Promise<boolean> {
    if (this.locked || api.signal.aborted) return false;
    this.locked = true;
    const check = () => { if (api.signal.aborted) throw new Error('Aborted'); };
    const read = async (path: string) => { check(); const result = await api.read(path); check(); return result; };
    const post = async (path: string, body: object = {}) => { check(); const result = await api.post(path, body); check(); return result; };
    const update = (status: SyncView['status'], message: string) => {
      check(); this.view = { ...this.view, status, message }; changed(this.view);
    };
    try {
      if (this.view.status === 'done') this.view = { stage: 'strava', status: 'idle', message: '' };
      update('running', labels[this.view.stage] + ' · checking status');
      // Check both prerequisites before starting a new chain. Never silently skip a provider.
      if (this.view.stage === 'strava' && !this.job) {
        const capability = record(await read('/garmin/connection'));
        if (capability.enabled !== true) throw new WorkflowProblem('Garmin is unavailable. Check its connection in Providers, then continue.');
      }
      for (let index = stages.indexOf(this.view.stage); index < stages.length; index++) {
        this.view = { ...this.view, stage: stages[index]! };
        update('running', labels[this.view.stage] + ' · checking status');
        const stage = this.view.stage;
        let prefix: string;
        let endpoint: string;
        let body: object = {};
        let latest: Record<string, unknown> | null = null;
        if (stage === 'strava') {
          const connections = await read('/providers/connections');
          if (!Array.isArray(connections)) throw new Error('Invalid connections');
          const connection = connections.map(record).find(item => item.provider === 'strava');
          if (!connection || connection.status !== 'connected') throw new WorkflowProblem('Connect or reconnect Strava in Providers, then continue.');
          const id = identifier(connection.id);
          const jobs = await read('/providers/connections/' + id + '/jobs?limit=1');
          if (!Array.isArray(jobs)) throw new Error('Invalid jobs');
          latest = jobs.length ? record(jobs[0]) : null;
          if (latest && latest.connectionId !== id) throw new Error('Unexpected connection');
          prefix = '/providers/jobs/'; endpoint = '/providers/connections/' + id + '/sync';
          body = { mode: connection.lastSyncAt ? 'incremental' : 'initial_backfill' };
        } else if (stage === 'garmin') {
          const connection = record(await read('/garmin/connection'));
          if (connection.enabled !== true) throw new WorkflowProblem('Garmin is unavailable. Check its connection in Providers, then continue.');
          latest = connection.activeJob ? record(connection.activeJob) : null;
          prefix = '/garmin/jobs/'; endpoint = '/garmin/sync';
        } else {
          const state = record(await read('/daily/recalculation'));
          latest = state.activeJob ? record(state.activeJob) : state.latestJob ? record(state.latestJob) : null;
          prefix = '/daily/recalculation/jobs/'; endpoint = '/daily/recalculation';
        }
        if (this.job && this.prerequisiteJob) {
          if (!await this.finish(api, read, update)) return false;
          this.job = null; this.prerequisiteJob = false; latest = null;
        }
        const generalJob = (value: Record<string, unknown>) => stage === 'strava'
          ? value.mode === 'incremental' || value.mode === 'initial_backfill'
          : stage === 'garmin' ? value.operation === 'sync' : true;
        // An uncertain POST is reconciled before resubmission, including a job already completed.
        if (!this.job && this.pending && latest && generalJob(latest) && identifier(latest.id) !== this.pending.baseline) {
          this.job = parseSyncJob(latest); this.jobPrefix = prefix; this.pending = null;
        }
        if (!this.job && latest && activeSyncJob(parseSyncJob(latest))) {
          const existing = parseSyncJob(latest);
          const belongs = stage === 'strava' && generalJob(latest);
          this.job = existing; this.jobPrefix = prefix;
          // Targeted Strava work and downstream jobs that may predate this import finish before a fresh stage.
          if (!belongs) {
            this.prerequisiteJob = true;
            if (!await this.finish(api, read, update)) return false;
            this.job = null; this.prerequisiteJob = false;
            latest = null;
          }
        }
        if (!this.job) {
          this.pending = { baseline: latest ? identifier(latest.id) : null };
          this.jobPrefix = prefix;
          this.job = parseSyncJob(await post(endpoint, body));
          this.pending = null;
        }
        if (!await this.finish(api, read, update)) return false;
        this.job = null;
      }
      update('done', 'Everything is up to date. Strava, Garmin and scores updated.');
      return true;
    } catch (error) {
      if (!api.signal.aborted) update('error', error instanceof WorkflowProblem ? error.message : labels[this.view.stage] + ' could not be confirmed. Continue to check status safely.');
      return false;
    } finally { this.locked = false; }
  }

  private async finish(api: SyncTransport, read: (path: string) => Promise<unknown>, update: (status: SyncView['status'], message: string) => void): Promise<boolean> {
    const initial = this.job!;
    const report = (job: SyncJob) => update('running', labels[this.view.stage] + ' · ' + job.status + ' · ' + (stages.indexOf(this.view.stage) + 1) + ' / 3');
    report(initial);
    const result = await api.watch(initial, async () => {
      const job = parseSyncJob(await read(this.jobPrefix + initial.id));
      if (job.id !== initial.id) throw new Error('Unexpected job');
      return job;
    }, report);
    if (!result) { update('paused', labels[this.view.stage] + ' is still pending. Continue update to check the same job.'); return false; }
    if (result.id !== initial.id) throw new Error('Unexpected job');
    if (result.status !== 'succeeded') {
      // A later explicit click starts this stage again using the server cursor.
      this.job = null; this.prerequisiteJob = false;
      throw new WorkflowProblem(labels[this.view.stage] + ' ' + result.status + '. Later stages have not started. Continue to try this stage again.');
    }
    return true;
  }
}
