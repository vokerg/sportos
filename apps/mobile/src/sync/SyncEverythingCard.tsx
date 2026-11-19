import React, { useRef, useState } from 'react';
import { SyncEverything, activeSyncJob, syncButtonLabel, type SyncView } from '../../../../packages/shared/src/sync-everything';
import { pollDelay, useOperation } from '../providers/use-operation';
import { Action, Body, Card } from '../ui/primitives';

export function SyncEverythingCard({ onUpdated }: { onUpdated(): void }) {
  const workflow = useRef(new SyncEverything());
  const [view, setView] = useState<SyncView>(workflow.current.view);
  const operation = useOperation();
  const start = () => { void operation.run(async api => workflow.current.run({
    signal: api.signal,
    read: path => api.read(path),
    post: (path, body) => api.mutate(path, body),
    watch: async (initial, read, report) => {
      let job = initial;
      for (let attempt = 0; ; attempt++) {
        if (api.signal.aborted) throw new Error('Aborted');
        report(job);
        if (!activeSyncJob(job)) return job;
        if (attempt === 24) return null;
        await pollDelay(api.signal);
        job = await read();
      }
    },
  }, next => { if (!api.signal.aborted) setView(next); }), done => { if (done) onUpdated(); },
  'Update could not be confirmed. Continue to check status safely.'); };
  return <Card title="Update your training">
    <Action title={syncButtonLabel(view)} disabled={operation.busy} onPress={start}/>
    <Body>{view.message}</Body>
    {operation.error ? <Body subdued>{operation.error}</Body> : null}
    <Body subdued>Import Strava, sync Garmin, then recalculate scores. Repeat any time.</Body>
    <Body subdued>Keep Home open for the next step. If you leave, return and continue; queued work is saved.</Body>
  </Card>;
}
