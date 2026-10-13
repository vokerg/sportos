import { describe,expect,it } from 'vitest';
import { stravaSummaryRoute } from './activity-route.js';
import { decodeStoredRoute,decodeRichPolyline,encodeRoutePolyline,
 projectGarminRoute,projectStravaRoute } from './activity-route-projection.js';
type Point=[number,number];
const a:Point=[12.5,55.7],b:Point=[12.5005,55.7005],c:Point=[12.501,55.7006];
const summary=stravaSummaryRoute(encodeRoutePolyline([a,c]),'string');
function decode(route:NonNullable<ReturnType<typeof projectStravaRoute>>){
 return decodeStoredRoute({
  provider:route.provider,resolution:route.resolution,polylines:route.polylines,
  bounds:route.bounds,point_count:route.pointCount,
 });
}
describe('retained-only GPS route normalization',()=>{
 it('converts Strava latlng streams into longitude-first bounded GeoJSON and persists a stable compact signature',()=>{
  const streams={latlng:{data:[[55.6999,12.4999],[55.7,12.5],[55.7005,12.5005],[55.7006,12.501],[55.701,12.502]]},
    time:{data:[0,10,20,30,40]}};
  const route=projectStravaRoute(streams,null,summary);
  expect(route).toMatchObject({provider:'strava',resolution:'streams',pointCount:3});
  expect(decode(route!)).toMatchObject({status:'available',source:'strava',resolution:'streams',
   geometry:{type:'LineString',coordinates:[a,b,c]}});
  expect(route!.resourceHash).toBe(projectStravaRoute(streams,null,summary)?.resourceHash);
  expect(JSON.stringify(route)).not.toContain('55.6999');
  expect(JSON.stringify(route)).not.toContain('55.701');
 });
 it('uses Strava detailed polyline when GPS streams lack qualified coordinates',()=>{
  const polyline=encodeRoutePolyline([a,b,c]);
  expect(decodeRichPolyline(polyline)).toEqual([a,b,c]);
  const route=projectStravaRoute({latlng:{data:[null]}},{map:{polyline}},summary);
  expect(route?.resolution).toBe('detail');
  expect(decode(route!)).toMatchObject({geometry:{coordinates:[a,b,c]}});
 });
 it('never upgrades from missing/invalid summary, even if rich GPS is retained',()=>{
  const stream={latlng:{data:[[55.7,12.5],[55.7005,12.5005],[55.7006,12.501]]}};
  expect(projectStravaRoute(stream,null,{status:'unavailable',reason:'summary_polyline_missing'})).toBeNull();
  expect(projectStravaRoute(stream,{map:{polyline:encodeRoutePolyline([a,b,c])}},
   {status:'unavailable',reason:'invalid_geometry'})).toBeNull();
 });
 it('rejects malformed/unbounded polylines and coordinate order mismatches',()=>{
  expect(decodeRichPolyline('!!')).toBeNull();
  expect(decodeRichPolyline('x'.repeat(500001))).toBeNull();
  expect(projectStravaRoute({latlng:{data:[[181,0],[182,0]]}},null,summary)).toBeNull();
 });
 it('normalizes Garmin FIT semicircle fields without double converting degree-valued fields',()=>{
  const raw=(point:Point,time:string,units:'semicircles'|'degrees')=>({
   message:'record',fields:[
    {name:'position_lat',value:units==='semicircles'?point[1]*2**31/180:point[1],units},
    {name:'position_long',value:units==='semicircles'?point[0]*2**31/180:point[0],units},
    {name:'timestamp',value:time,units:null},
   ],
  });
  const route=projectGarminRoute([
   raw(a,'2026-10-01T00:00:00Z','semicircles'),
   raw(b,'2026-10-01T00:00:10Z','degrees'),
   raw(c,'2026-10-01T00:00:20Z','semicircles'),
  ]);
  expect(route).toMatchObject({provider:'garmin',resolution:'fit',pointCount:3});
  expect(decode(route!)).toMatchObject({source:'garmin',resolution:'fit',
   geometry:{type:'LineString',coordinates:[a,b,c]}});
 });
 it('preserves recording gaps as MultiLineString rather than joining separated tracks',()=>{
  const fix=(p:Point,seconds:number)=>({message:'record',fields:[
   {name:'position_lat',value:p[1],units:'degrees'},
   {name:'position_long',value:p[0],units:'degrees'},
   {name:'timestamp',value:new Date(Date.UTC(2026,0,1,0,0,seconds)).toISOString(),units:null},
  ]});
  const route=projectGarminRoute([fix(a,0),fix(b,10),fix(b,11),fix(c,12)]);
  expect(route?.pointCount).toBe(4);
  const gap=projectGarminRoute([fix(a,0),fix(b,10),{message:'record',fields:[]},fix(b,20),fix(c,30)]);
  expect(gap?.polylines).toHaveLength(2);
  expect(decode(gap!)).toMatchObject({geometry:{type:'MultiLineString',
   coordinates:[[a,b],[b,c]]}});
 });
 it('ignores fabricated or unknown FIT coordinates and rejects invalid persisted projections',()=>{
  expect(projectGarminRoute([{message:'record',fields:[{name:'position_lat',value:50,units:null}]},
   {message:'record',fields:[] }])).toBeNull();
  expect(decodeStoredRoute({provider:'garmin',resolution:'fit',polylines:['?'],bounds:[0,0,1,1],point_count:2})).toBeNull();
  expect(decodeStoredRoute({provider:'strava',resolution:'streams',polylines:[encodeRoutePolyline([a,b])],
   bounds:[-200,0,1,1],point_count:2})).toBeNull();
 });
});
