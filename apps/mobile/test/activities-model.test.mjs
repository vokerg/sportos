import test from 'node:test';
import assert from 'node:assert/strict';
import {activityDetailPath,activityListPath,activityDistance,effortRows,projectActivityList,projectActivityDetail,
  projectEnrichment,projectSwimLengths,projectLaps,projectGarminSets,providerLabel,summaryMetrics} from '../src/activities/model.mjs';
const id='e1f985f4-ffb1-43e0-8e89-c60214b13d3f';
const activity=(activity_type='run',extra={})=>({
  id,activity_date:'2026-10-26',start_time:'2026-10-26T16:40:00Z',activity_type,source:'strava',
  subtype:null,distance_m:10000,duration_s:3000,moving_time_s:2900,avg_hr:146,max_hr:174,
  calories:640,elevation_gain_m:30,avg_speed_mps:3.44,avg_pace_s_per_km:290,steps:null,
  providerMetrics:[{provider:'strava',linked:true,rawRetained:false,state:'partial',compactOnly:true}],
  ...extra,
});
const feed=(items=[activity()],count=items.length)=>({items,summary:{count,durationS:3000,distanceM:10000,avgDistanceM:10000,avgPaceSPerKm:290},limit:25,offset:0});
const detail=(kind,extra={})=>({...activity(kind),bestEfforts:null,metricComparisons:[],
  garminStrength:null,provenance:{sourceRecordId:'private-id',sourceRecordSource:'strava_api'},
  providerDetail:{provider:'strava',providerActivityId:'123'},garmin:null,
  notes:'Long run',...extra});

test('list paths use bounded date-only filters and never owner or rich-data parameters',()=>{
  assert.equal(activityListPath({range:'30d',type:'run',source:'strava',today:'2026-10-27',offset:25}),
    '/activities?from=2026-09-28&to=2026-10-27&activityType=run&source=strava&limit=25&offset=25');
  assert.equal(activityListPath({range:'all'}),'/activities?limit=25&offset=0');
  assert.equal(activityDetailPath(id),'/activities/'+id);
  assert.throws(()=>activityDetailPath('../auth/session'));
  assert.throws(()=>activityListPath({range:'7d',today:'2026-10-27'}));
  assert.throws(()=>activityListPath({source:'strava&owner=abc',today:'2026-10-27'}));
  assert.throws(()=>activityListPath({today:'2026-10-27',offset:100001}));
});
test('canonical list preserves run, swim, bike, workout and walk without source payloads',()=>{
  const rows=['run','swim','bike','workout','walk'].map((t,i)=>activity(t,{id:id.slice(0,-1)+i}));
  const data=projectActivityList(feed(rows,5));
  assert.equal(data.items.length,5);
  assert.deepEqual(data.items.map(a=>a.activity_type),['run','swim','bike','workout','walk']);
  assert.equal(data.items[0].providerMetrics[0].rawRetained,false);
  assert.equal(data.items[0].source_activity_id,undefined);
  assert.equal(data.items[0].notes,undefined);
  assert.equal(data.items[0].owner_id,undefined);
  assert.match(providerLabel(data.items[0].providerMetrics[0]),/summary only/);
});
test('feed must be bounded, well-shaped and have genuine canonical identifiers',()=>{
  assert.throws(()=>projectActivityList({...feed(),items:[activity('run',{distance_m:Infinity})]}));
  assert.throws(()=>projectActivityList({...feed(),items:[activity('run',{id:'not-a-uuid'})]}));
  assert.throws(()=>projectActivityList({...feed(),summary:{count:-1}}));
  assert.throws(()=>projectActivityList({...feed(),limit:101}));
  assert.throws(()=>projectActivityList({...feed(),summary:{count:0}}));
  assert.throws(()=>projectActivityList({...feed(),items:[activity('run',{providerMetrics:[{provider:'bad',state:'processed'}]})]}));
});
test('running detail keeps canonical pace, provenance and server effort method distinct',()=>{
  const raw=detail('run',{bestEfforts:{targets:[5000],providers:[
    {provider:'strava',state:'current',efforts:[{targetDistanceM:5000,method:'summary_estimate',status:'estimated',durationS:1450}]},
    {provider:'garmin',state:'stale',efforts:[{targetDistanceM:5000,method:'fit_calculated',status:'calculated',durationS:1410}]},
  ]},metricComparisons:[{key:'cadence',label:'Cadence',unit:'rpm',selected:{value:86,source:'strava',reason:'provider_priority'},
    candidates:[{provider:'strava',value:86,sourceField:'average_cadence',projectionId:'private-details'}]}],
    secret:'should not survive'});
  const data=projectActivityDetail(raw);
  assert.equal(data.name,'Long run');
  assert.equal(data.provenance,'strava_api');
  assert.equal(data.linkedStrava,true);
  assert.equal(data.metricComparisons[0].value,86);
  assert.equal(data.metricComparisons[0].candidates,undefined);
  assert.equal(data.secret,undefined);
  assert.deepEqual(effortRows(data.bestEfforts).map(x=>[x.status,x.method,x.durationS]),
    [['estimated','summary_estimate',1450]]);
  assert.match(summaryMetrics(data).find(m=>m.label==='Pace').value,/km/);
});
test('corrected indoor swim displays effective total, recorded FIT lengths and SWOLF only when evidenced',()=>{
  const item=projectActivityDetail(detail('swim',{subtype:'indoor',distance_m:1000,avg_pace_s_per_km:1150,
    distanceCorrection:{recordedDistanceM:1024,effectiveDistanceM:1000,revision:1}}));
  assert.equal(activityDistance(item),'1,000 m');
  assert.equal(item.distanceCorrection.recordedDistanceM,1024);
  assert.match(summaryMetrics(item).find(m=>m.label==='Pace').value,/100 m/);
  const lengths=projectSwimLengths({status:'available',poolLengthM:25,complete:true,truncated:false,
    expectedLengths:2,recordedDistanceM:1024,effectiveDistanceM:1000,effectiveActiveLengths:40,
    lengths:[
      {row:1,lengthNumber:1,kind:'active',durationS:24,durationBasis:'timer',paceSPer100M:96,strokes:21,swolf:45,stroke:'freestyle'},
      {row:2,lengthNumber:null,kind:'rest',durationS:10,durationBasis:'elapsed',paceSPer100M:null,strokes:null,swolf:null,stroke:null},
    ]});
  assert.equal(lengths.poolLengthM,25);
  assert.equal(lengths.lengths[0].swolf,45);
  assert.equal(lengths.lengths[1].kind,'rest');
  assert.equal(lengths.effectiveDistanceM,1000);
  assert.deepEqual(projectSwimLengths({status:'unavailable',reason:'no_length_messages',lengths:[]}).lengths,[]);
  assert.throws(()=>projectSwimLengths({status:'available',poolLengthM:25,lengths:[{row:1,kind:'active',swolf:Infinity}]}));
});
test('outdoor swim remains a canonical distance; no implied pool splits, GPS, or fetch',()=>{
  const row=projectActivityDetail(detail('swim',{subtype:'outdoor',distance_m:1800,avg_pace_s_per_km:null,notes:null}));
  assert.equal(activityDistance(row),'1,800 m');
  assert.equal(row.avg_pace_s_per_km,null);
  assert.equal(row.poolLengthM,undefined);
  assert.equal(row.route,undefined);
});
test('run laps preserve provider order and do not derive splits for missing fields',()=>{
  const s=projectLaps({resources:{laps:{availability:'available',payload:[
    {distance:1000,moving_time:260,elapsed_time:280,average_heartrate:150},
    {distance:null,elapsed_time:45},
  ]}}},'strava');
  assert.equal(s.rows.length,2);
  assert.equal(s.rows[0].paceSPerKm,260);
  assert.equal(s.rows[0].basis,'moving');
  assert.equal(s.rows[1].paceSPerKm,null);
  const g=projectLaps({laps:[{message:'lap',fields:[
    {name:'total_distance',value:400,units:'m'},
    {name:'total_timer_time',value:112,units:'s'},
    {name:'avg_heart_rate',value:138,units:'bpm'},
  ]},{message:'session',fields:[]}]},'garmin');
  assert.equal(g.rows.length,1);
  assert.equal(g.rows[0].paceSPerKm,280);
  assert.equal(g.rows[0].basis,'timer');
  assert.equal(g.rows[0].heartRate,138);
  const duplicates=projectLaps({laps:[{message:'lap',fields:[
    {name:'total_distance',value:400,units:'m'},{name:'total_distance',value:450,units:'m'},
    {name:'total_timer_time',value:110,units:'s'},
  ]}]},'garmin');
  assert.equal(duplicates.rows[0].distanceM,null);
});
test('ride, gym and walk present only evidenced metrics and sets',()=>{
  const bike=projectActivityDetail(detail('bike',{avg_speed_mps:8.2,avg_pace_s_per_km:null}));
  assert.match(summaryMetrics(bike).find(m=>m.label==='Average speed').value,/km\/h/);
  const gym=projectActivityDetail(detail('workout',{distance_m:null,
    garminStrength:{workingSets:8,totalRecordedSets:10,warmupSets:2,restMarkers:3,complete:false,
      exercises:[{name:'Squat',workingSets:4},{name:'Bench',workingSets:4}]}}));
  assert.equal(gym.garminStrength.workingSets,8);
  const rows=projectGarminSets({sets:{exerciseSets:[{exerciseName:'squat',repetitions:12,duration:36,privateObject:{x:1}}]}});
  assert.deepEqual(rows,[[{label:'exercise Name',value:'squat'},{label:'repetitions',value:'12'},{label:'duration',value:'36'}]]);
  const walk=projectActivityDetail(detail('walk',{distance_m:2400,steps:3400,avg_pace_s_per_km:null}));
  assert.match(summaryMetrics(walk).find(m=>m.label==='Steps').value,/3,400/);
});
test('coverage never authorizes a Garmin fetch unless server advertises it',()=>{
  assert.deepEqual(projectEnrichment({strava:{state:'cached'},garmin:{state:'linked',linked:true,fetchEnabled:false}}),
    {strava:'cached',garmin:'linked',garminFetchEnabled:false});
  assert.throws(()=>projectEnrichment({strava:{state:'unexpected'},garmin:{state:'linked'}}));
});

test('provider names with control characters are safely normalized without exposing raw records',()=>{
  const row=projectActivityDetail(detail('run',{notes:'My race\nAt home',owner_id:'private-account',rawJson:{token:'private'}}));
  assert.equal(row.name,'My race At home');
  assert.equal(row.owner_id,undefined);
  assert.equal(row.rawJson,undefined);
});

test('Garmin run classification changes presentation only for unclassified runs',()=>{
  const garmin={source:'garmin',subtype:'track'};
  const row=projectActivityDetail(detail('run',{subtype:'outdoor',runClassification:garmin}));
  assert.equal(row.subtype,'track');
  assert.equal(row.source,'strava');
  assert.equal(projectActivityDetail(detail('run',{subtype:'treadmill',runClassification:garmin})).subtype,'treadmill');
  assert.equal(projectActivityDetail(detail('swim',{subtype:'indoor',runClassification:garmin})).subtype,'indoor');
  assert.equal(projectActivityDetail(detail('run',{subtype:null,runClassification:{source:'garmin',subtype:'invalid'}})).subtype,null);
});
test('garmin exercise set projection excludes arbitrary private FIT fields and nonfinite values',()=>{
  const rows=projectGarminSets({sets:{exerciseSets:[{exerciseName:'Squat',repetitions:12,weightKg:80,
    rawJson:'sensitive',latitude:'55.6761',token:'secret',secret:123,weight:Infinity}]}});
  assert.deepEqual(rows,[[{label:'exercise Name',value:'Squat'},{label:'repetitions',value:'12'},{label:'weight Kg',value:'80'}]]);
});
