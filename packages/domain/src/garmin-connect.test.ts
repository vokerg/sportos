import {describe,it,expect} from 'vitest';
import {connectChart,completeConnectBundle,garminJsonEfforts,inspectActivityMetrics} from './index.js';
const names=[['directTimestamp','gmt'],['sumDuration','second'],['sumDistance','meter'],['directHeartRate','bpm']];
export function chart() {return {totalMetricsCount:7,metricDescriptors:names.map(([key,unit],metricsIndex)=>({key,metricsIndex,unit:{key:unit}})),activityDetailMetrics:Array.from({length:7},(_,i)=>({metrics:[1700000000000+i*100000,i*100,i*1000,140]}))};}
// Use <=30s gaps and realistic speed for measured 5km windows.
export function runChart(){const c=chart();c.totalMetricsCount=601;c.activityDetailMetrics=Array.from({length:601},(_,i)=>({metrics:[1700000000000+i*2000,i*2,i*10,140]}));return c;}
export function detail(sport='running'){return {metadata:{activityTypeDTO:{typeKey:sport},summaryDTO:{duration:1200,elapsedDuration:1200,distance:6000}},details:runChart(),acquisition:{version:1,kind:'json',fallbackReasons:[],expectedResources:['detail','sets','laps'].map(resourceType=>({resourceType,chunkIndex:0}))}};}
describe('native Connect JSON',()=>{
 it('retains actual values rather than reapplying unit.factor, rejects decimation/duplicates/unknown units',()=>{
  const c=runChart();expect(connectChart(c)?.sumDistance[1]).toBe(10);
  expect(connectChart({...c,totalMetricsCount:1000})).toBeNull();
  expect(connectChart({...c,metricDescriptors:[...c.metricDescriptors,c.metricDescriptors[0]]})).toBeNull();
  c.metricDescriptors[0].unit.key='unknown';expect(connectChart(c)).toBeNull();
 });
 it('validates required resources and timer continuity independently of claimed coverage',()=>{
  const d=detail(),laps={lapDTOs:[{duration:1200,elapsedDuration:1200}]};
  expect(completeConnectBundle(d,laps,{})).toBe(true);
  expect(completeConnectBundle(d,null,{})).toBe(false);
  d.details.activityDetailMetrics[1].metrics[1]=1;expect(completeConnectBundle(d,laps,{})).toBe(false);
  expect(completeConnectBundle(detail('lap_swimming'),laps,{})).toBe(false);
 });
 it('measures sub-lap windows without pretending JSON is FIT, and refuses mixed/gapped recordings',()=>{
  const c=runChart();const efforts=garminJsonEfforts({duration:1200,elapsedDuration:1200},c);
  expect(efforts[0]).toMatchObject({method:'json_calculated',status:'calculated',durationS:1000,startOffsetS:0,endOffsetS:1000,pauseCoverage:'validated'});
  c.activityDetailMetrics[1].metrics[1]=1;expect(garminJsonEfforts({duration:1190,elapsedDuration:1200},c)[0].status).toBe('unavailable');
  c.activityDetailMetrics[1].metrics[1]=2;
  c.activityDetailMetrics[1].metrics[0]+=40000;expect(garminJsonEfforts({duration:1200,elapsedDuration:1200},c)[0].status).toBe('unavailable');
 });
 it('excludes fully evidenced pause time and drift from measured native windows',()=>{
  const c=runChart();
  // Add an explicitly stopped interval; every later timer retains active time.
  c.activityDetailMetrics.splice(301,0,{metrics:[1700000000000+700000,600,3001,140]});
  for(let i=302;i<c.activityDetailMetrics.length;i++)c.activityDetailMetrics[i].metrics[0]+=100000;
  c.totalMetricsCount=c.activityDetailMetrics.length;
  const efforts=garminJsonEfforts({duration:1200,elapsedDuration:1300},c);
  expect(efforts[0]).toMatchObject({method:'json_calculated',pausePolicy:'cumulative_timer',status:'calculated'});
  expect(efforts[0].durationS).toBeGreaterThan(1000); // Drift was excluded from distance.
 });
 it('maps native summary units and provenance, leaving absent sensors missing',()=>{
  const observed=inspectActivityMetrics('run',[{provider:'garmin',sourceKind:'garmin_summary',fields:{averageRunCadence:180,strideLength:110,verticalOscillation:8,groundContactTime:230,trainingEffect:3.2}}]);
  expect(observed.observations).toEqual(expect.arrayContaining([
   expect.objectContaining({metricKey:'running_cadence',value:180,sourceKind:'garmin_summary',sourceField:'averageRunCadence'}),
   expect.objectContaining({metricKey:'step_length',value:1.1}),expect.objectContaining({metricKey:'vertical_oscillation',value:80}),
  ]));
  expect(observed.observations.some(x=>x.metricKey==='average_power')).toBe(false);
 });
});
