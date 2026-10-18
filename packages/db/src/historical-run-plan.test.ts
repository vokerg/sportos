import { describe, expect, it } from 'vitest';
import { planHistoricalRun as plan, type HistoricalRunDay, type HistoricalRunRecord } from './historical-run-plan.js';
const record=(distanceM=5000,durationS=1500):HistoricalRunRecord=>({id:String(distanceM),date:'2074-05-01',distanceM,durationS,treadmill:true,sourceRecordId:'record',locked:false});
const day:HistoricalRunDay={date:'2074-05-01',daily:{distanceM:10000,sourceRecordId:'daily',subtype:'unknown'},records:[],activities:[]};
describe('historical run reconstruction',()=>{
 it('uses daily distance once and never extrapolates a subdistance time',()=>{const r=plan({...day,records:[record()]});expect(r.create).toMatchObject({distanceM:10000,durationS:null,subtype:'treadmill',basis:'daily_total'});expect(r.links).toHaveLength(1);});
 it('links multiple achievement distances to one summary with exact full-distance time',()=>{const r=plan({...day,records:[record(),record(10000,3600)]});expect(r.create).toMatchObject({distanceM:10000,durationS:3600,timingEventId:'10000'});expect(r.links).toHaveLength(2);});
 it('retains unknown semantics and rejects conflicting full-distance duration',()=>{expect(plan(day).create).toMatchObject({subtype:'unknown',durationS:null});const a=record(10000,3600),b={...a,id:'second',durationS:3700};expect(plan({...day,records:[a,b]}).create?.durationS).toBeNull();});
 it('fills record-only dates once using the largest distance without inventing device/session count',()=>{const r=plan({...day,daily:null,records:[record(),record(10000,3600)]});expect(r.create).toMatchObject({source:'run_db_xlsx',distanceM:10000,basis:'running_records'});expect(r.links).toHaveLength(2);});
 it('never adds a duplicate around provider/manual workouts or guesses between historical candidates',()=>{const a={id:'existing',source:'strava',distanceM:10000,subtype:'treadmill'};expect(plan({...day,records:[record()],activities:[a]})).toMatchObject({create:null,links:[]});const w={...a,source:'my_sport_xlsx'};expect(plan({...day,records:[record()],activities:[w,{...w,id:'other'}]}).links).toHaveLength(0);});
 it('does not steal accepted/rejected/reviewed identities or link targets beyond retained day distance',()=>{const r=plan({...day,daily:{...day.daily!,distanceM:5000},records:[{...record(),locked:true},record(10000)]});expect(r.links).toHaveLength(0);});
});
