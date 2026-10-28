import test from 'node:test';
import assert from 'node:assert/strict';
import {projectRoute,projectHeatmap,mapData} from '../src/maps/model.mjs';
const route={source:'strava',resolution:'summary',geometry:{type:'MultiLineString',coordinates:[[[12,55],[12.01,55.01]],[[12.02,55.02],[12.03,55.03]]]}};
test('route projection preserves GPS gaps, bounds and start/finish without private fields',()=>{
 const clean=projectRoute({...route,status:'available',owner_id:'private',raw:{secret:true}});
 assert.equal(clean.owner_id,undefined);assert.equal(clean.raw,undefined);
 const data=mapData([clean]);assert.equal(data.lines.features.length,2);
 assert.deepEqual(data.start,[12,55]);assert.deepEqual(data.finish,[12.03,55.03]);
 assert.deepEqual(data.bounds,[[12,55],[12.03,55.03]]);
});
test('pool and missing GPS are explicit; malformed, oversized and nonfinite geometry fails closed',()=>{
 assert.deepEqual(projectRoute({status:'unavailable',reason:'indoor_pool_swim'}),{status:'unavailable',reason:'indoor_pool_swim'});
 for(const geometry of [null,{type:'LineString',coordinates:[[181,55],[12,55]]},{type:'LineString',coordinates:[[12,NaN],[12,55]]},{type:'LineString',coordinates:Array(5001).fill([12,55])}])assert.throws(()=>projectRoute({...route,status:'available',geometry}));
});
test('density counts each route once per occupied cell and keeps route count honest',()=>{
 const dense={...route,geometry:{type:'LineString',coordinates:Array(10).fill([12,55])}};
 const data=mapData([dense,dense]);assert.equal(data.density.features.length,1);assert.equal(data.density.features[0].properties.weight,2);
});
test('heatmap allowlists coverage and bounded cursor, never retains identities',()=>{
 const page=projectHeatmap({items:[{...route,activityId:'private'}],hasMore:true,nextCursor:'abc',coverage:{eligibleScanned:2,usable:1,missingGps:1,invalidGeometry:0,budgetExceeded:0,owner:'private'}});
 assert.equal(page.items[0].activityId,undefined);assert.equal(page.coverage.owner,undefined);
 assert.throws(()=>projectHeatmap({...page,nextCursor:'../private'}));
 assert.throws(()=>projectHeatmap({...page,items:Array(26).fill(route)}));
});

test('map endpoint and memory budgets stay bounded without silent density truncation',async()=>{
 const {routePath}=await import('../src/maps/model.mjs');
 assert.equal(routePath('00000000-0000-4000-8000-000000000001'),'/activities/00000000-0000-4000-8000-000000000001/map');
 assert.throws(()=>routePath('../private'));
 const routes=Array.from({length:4},(_,j)=>({...route,geometry:{type:'LineString',coordinates:Array.from({length:5000},(_,i)=>[i*.001,54+j*.1])}}));
 const data=mapData(routes);assert.equal(data.lines.features.length,4);assert.equal(data.points,20000);assert.equal(data.density.features.length,15000);assert.equal(data.densityTruncated,true);
 assert.throws(()=>mapData(Array(51).fill(route)));
});
