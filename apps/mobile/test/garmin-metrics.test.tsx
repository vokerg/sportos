import {expect,it} from 'vitest';
import {metricEntries,formatDayMetric} from '../src/daily/garmin-metrics';
import {garminDay} from '../src/providers/model';
import {sourceLabel} from '../src/ui/source-label';
it('shows recorded health measurements with meaningful units and preserves zero and missing',()=>{
 const sleep=metricEntries('sleep',{sleepSeconds:27600,deepSleepSeconds:null,remSleepSeconds:0,notes:'private',raw:{secret:true}});
 expect(sleep.map(m=>[m.label,formatDayMetric(m)])).toEqual([['Sleep','7h 40m'],['REM sleep','0h 0m']]);
 expect(metricEntries('summary',{steps:0,distanceM:1234}).map(formatDayMetric)).toEqual(['0','1.23 km']);
 expect(metricEntries('hrv',{lastNightAvgMs:null})).toEqual([]);
 expect(metricEntries('body_battery',{charged:48,drained:62}).map(m=>m.label)).toEqual(['Body Battery gained','Body Battery used']);
 expect(()=>metricEntries('heart_rate',{restingBpm:Infinity})).toThrow();
});
it('uses the most recent timestamped measurement and never guesses among undated measurements',()=>{
 const values=metricEntries('weight',{measurements:[{recordedAt:'2026-10-29T07:00:00Z',weightKg:75.2},{recordedAt:'2026-10-29T08:00:00Z',weightKg:75.4,bodyFatPct:14.2}]});
 expect(values.map(formatDayMetric)).toEqual(['75.4 kg','14.2 %']);
 expect(metricEntries('weight',{measurements:[{weightKg:74},{weightKg:75}]})).toEqual([]);
});
it('keeps old measurements on partial failure without copying private Garmin fields',()=>{
 const day=garminDay({date:'2026-10-29',origin:'garmin_connect',evidenceOnly:true,fetchEnabled:true,state:'partial',completeness:'refresh_required',categories:[{category:'heart_rate',state:'rate_limited',retainedState:'available',retainedAt:'2026-10-29T08:00:00Z',evidence:{restingBpm:52,privateNarrative:'private',userId:'private'}}]},'2026-10-29');
 expect(day.categories[0].metrics).toEqual([{key:'heart_rate.restingBpm',label:'Resting heart rate',value:52,unit:'bpm'}]);
 expect(JSON.stringify(day)).not.toContain('private');expect(day.categories[0].state).toBe('rate_limited');
});
it('keeps adapter class names out of source labels',()=>{
 expect(sourceLabel('strava_api')).toBe('Strava');expect(sourceLabel('unknown_internal_table')).toBe('Imported');
});
