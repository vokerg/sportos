import test from 'node:test';import assert from 'node:assert/strict';
import {METRICS,analyticsPath,projectMonthly,projectRolling,chartSegments} from '../src/analytics/model.mjs';
test('analytics query uses current server catalog and exact dates without local rolling semantics',()=>{assert.match(analyticsPath({mode:'rolling',from:'2026-10-01',to:'2026-10-28',window:7}),/windows=7/);assert.throws(()=>analyticsPath({mode:'rolling',from:'2026-10-01',to:'2026-10-28',window:10}));assert.throws(()=>analyticsPath({mode:'monthly',from:'2026-02-30',to:'2026-10-28'}));});
test('monthly projection preserves missing/zero/negative values, units and API contribution totals',()=>{
 const month={key:'2026-10',from:'2026-10-01',to:'2026-10-28',recordedDays:1,calendarDays:28,partial:true,values:Object.fromEntries(METRICS.map(m=>[m,{total:m==='score'?-10:0,recordedDayAverage:0}])),distanceTotals:{run:10000},scoreContributions:{run:5000,unattributed:-5010},notes:'private'};
 const [r]=projectMonthly({monthly:[month]});assert.equal(r.values.score.total,-10);assert.equal(r.values.steps.total,0);assert.equal(r.distances.run,10000);assert.equal(r.contributions.unattributed,-5010);assert.equal(r.notes,undefined);
 assert.equal(projectMonthly({monthly:[{...month,recordedDays:0,values:Object.fromEntries(METRICS.map(m=>[m,{total:null,recordedDayAverage:null}]))} ]})[0].values.score.total,null);
});
test('rolling projection retains server totals, null gaps and incomplete window coverage unchanged',()=>{
 const r=projectRolling({metric:'score',unit:'points',windows:[30],points:[{date:'2026-10-28',dailyValue:null,windows:{30:{total:30,calendarDayAverage:1,activeDays:1,recordedDays:1,windowDays:30,complete:false}}}],scoreContributions:{30:{points:[{date:'2026-10-28',total:1,contributions:{steps:1}}]}}},'score',30);
 assert.equal(r.points[0].total,30);assert.equal(r.points[0].average,1);assert.equal(r.points[0].dailyValue,null);assert.equal(r.points[0].complete,false);assert.equal(r.contributions[0].values.steps,1);
 assert.throws(()=>projectRolling({metric:'score',unit:'points',windows:[30],points:[{date:'2026-10-28',dailyValue:NaN,windows:{}}]},'score',30));
});
test('native chart disconnects missing data and supports signed values without fabricating zeros',()=>{const s=chartSegments([null,0,-10,null,20]);assert.equal(s.length,2);assert.deepEqual(s.map(a=>a.map(p=>p.index)),[[1,2],[4]]);assert.ok(s[0][0].y<s[0][1].y);assert.equal(chartSegments([null,null]).length,0);});

test('phone rolling ranges are limited to a year while monthly history stays bounded',()=>{
 assert.throws(()=>analyticsPath({mode:'rolling',from:'2020-01-01',to:'2026-10-28'}));
 assert.match(analyticsPath({mode:'monthly',from:'2020-01-01',to:'2026-10-28'}),/granularity=monthly/);
 assert.throws(()=>analyticsPath({mode:'monthly',from:'2000-01-01',to:'2026-10-28'}));
});

test('compact all-history projection preserves server records and supports history beyond the legacy year limit',async()=>{
 const {historyPath,projectHistory}=await import('../src/analytics/model.mjs');
 assert.equal(historyPath('2026-11-21'),'/dynamics/history?to=2026-11-21');
 assert.throws(()=>historyPath('2101-01-01'));
 const raw={version:1,dates:['2016-01-01','2016-01-02'],daily:{steps:[100,null]},windows:{7:{totals:{steps:[100,100]},activeDays:{steps:[1,1]},recordedDays:[1,1]}},records:[{metric:'steps',windowDays:7,period:'all',date:'2016-01-07',value:100/7,recordedDays:1}]};
 const result=projectHistory(raw,'steps',7);assert.equal(result.points[1].dailyValue,null);assert.equal(result.points[1].average,100/7);assert.deepEqual(result.records,raw.records);
 assert.throws(()=>projectHistory({...raw,dates:['2016-01-01','2016-01-01']},'steps',7));
 assert.throws(()=>projectHistory({...raw,windows:{7:{...raw.windows[7],recordedDays:[8,1]}}},'steps',7));
 assert.throws(()=>projectHistory({...raw,daily:{steps:[100]}},'steps',7));
 assert.throws(()=>projectHistory({...raw,records:[{...raw.records[0],metric:'ownerId'}]},'steps',7));
 assert.deepEqual(projectHistory({version:1,dates:[],daily:{steps:[]},windows:{},records:[]},'steps',7).points,[]);
});

test('local viewport zoom and pan preserve range bounds without requests or aggregating values',async()=>{
 const {changeViewport}=await import('../src/analytics/model.mjs');const dates=Array.from({length:100},(_,i)=>new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10));const range={from:dates[20],to:dates[39]};
 assert.deepEqual(changeViewport(dates,range,null,'in'),{start:25,end:35});
 assert.deepEqual(changeViewport(dates,range,null,'out'),{start:5,end:55});
 assert.deepEqual(changeViewport(dates,range,{start:0,end:20},'earlier'),{start:0,end:20});
 assert.deepEqual(changeViewport(dates,range,{start:80,end:100},'later'),{start:80,end:100});
 assert.deepEqual(changeViewport(dates,range,null,'all'),{start:0,end:100});
});
