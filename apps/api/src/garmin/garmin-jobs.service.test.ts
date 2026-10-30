import {afterEach,expect,it,vi} from 'vitest';
import {GarminJobsRepository} from '@sportos/db';
import {GarminJobsService} from './garmin-jobs.service.js';
import {GarminJobsController} from './garmin-jobs.controller.js';
const owner='11111111-1111-4111-8111-111111111111';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()});
it('enqueues owner-bound day work without a helper and validates the connection calendar independently of server timezone',async()=>{
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-28T23:30:00Z'));
 const scoped=vi.fn(async(_owner:string,fn:(db:unknown)=>Promise<unknown>)=>fn({}));
 const subject=new GarminJobsService({withAccount:scoped} as never);
 vi.spyOn(GarminJobsRepository.prototype,'capability').mockResolvedValue({enabled:true,reason:'ready',connectionId:'synthetic',timeZone:'Europe/Copenhagen'});
 vi.spyOn(GarminJobsRepository.prototype,'active').mockResolvedValue(null);
 const enqueue=vi.spyOn(GarminJobsRepository.prototype,'enqueue').mockResolvedValue({id:'synthetic'} as never);
 await subject.enqueue(owner,{operation:'day',date:'2026-10-29',refresh:true});expect(enqueue).toHaveBeenCalledWith({operation:'day',date:'2026-10-29',refresh:true});expect(scoped.mock.calls.every(([id])=>id===owner)).toBe(true);
 await expect(subject.enqueue(owner,{operation:'day',date:'2026-10-30',refresh:true})).rejects.toMatchObject({status:400});expect(enqueue).toHaveBeenCalledTimes(1);
});
it('derives job ownership only from authentication and validates identifiers and mutation bodies',async()=>{
 const api={get:vi.fn(),cancel:vi.fn(),retry:vi.fn(),capability:vi.fn()};const controller=new GarminJobsController(api as never);
 controller.get(owner,{id:owner} as never);expect(api.get).toHaveBeenCalledWith(owner,owner);
 for(const body of [{ownerId:owner},{url:'https://invalid'},[],null])expect(()=>controller.cancel(owner,body,{id:owner} as never)).toThrow();
 expect(()=>controller.get('invalid',{id:owner} as never)).toThrow();
 controller.cancel(owner,{}, {id:owner} as never);expect(api.cancel).toHaveBeenCalledWith(owner,owner);
});
it('maps missing and foreign jobs to the same generic result',async()=>{
 vi.spyOn(GarminJobsRepository.prototype,'get').mockResolvedValue(null);
 const subject=new GarminJobsService({withAccount:async(_owner:string,fn:(db:unknown)=>unknown)=>fn({})} as never);
 await expect(subject.get(owner,owner)).rejects.toMatchObject({status:404,message:'Garmin job was not found.'});
});
