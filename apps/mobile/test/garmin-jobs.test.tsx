import React,{useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,expect,it,vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const {read,mutate}=vi.hoisted(()=>({read:vi.fn(),mutate:vi.fn()}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(effect:()=>void)=>useEffect(effect,[effect])}));
vi.mock('../src/auth/SessionProvider',()=>({useSession:()=>({read,mutate})}));
vi.mock('../src/ui/ProviderStatus',()=>({ProviderLogo:()=>null}));
vi.mock('../src/ui/theme',()=>({useSportosTheme:()=>({palette:{}})}));
vi.mock('../src/ui/primitives',()=>({Action:()=>null,Body:()=>null,Card:()=>null}));
vi.mock('react-native',()=>({Text:'Text',View:'View'}));
import {useGarminDay} from '../src/daily/GarminDayCard';
import {garminJob} from '../src/providers/garmin-jobs';
const date='2026-03-29',id='00000000-0000-4000-8000-000000000001';
const day={date,origin:'garmin_connect',evidenceOnly:true,fetchEnabled:true,state:'missing',completeness:'complete',categories:[]};
const queued={id,operation:'day',date,activityId:null,refresh:true,status:'queued',phase:'queued',attemptCount:0,errorCode:null};
let scope!:ReturnType<typeof useGarminDay>,tree:ReactTestRenderer|null=null;
function Probe(){scope=useGarminDay(date);return null}
async function mount(){await act(async()=>{tree=create(<Probe/>)})}
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=null;vi.resetAllMocks();vi.useRealTimers()});
it('projects only public job metadata and rejects different days, activities and unsupported statuses',()=>{
 expect(garminJob({...queued,owner:'private',leaseOwner:'private',session:{secret:true}},{operation:'day',date})).toEqual(queued);
 for(const raw of [{...queued,date:'2026-03-28'},{...queued,status:'unknown'},{...queued,operation:'activity'}])expect(()=>garminJob(raw,{operation:'day',date})).toThrow();
});
it('enqueues once, polls to success, rereads retained evidence and never recalculates',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(path:string)=>path.includes('/garmin/jobs/')?{...queued,status:'succeeded',phase:'succeeded'}:day);mutate.mockResolvedValue(queued);
 await mount();await act(async()=>{scope.refresh();scope.refresh()});expect(mutate).toHaveBeenCalledTimes(1);
 expect(scope.busy).toBe(true);await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});
 expect(scope.busy).toBe(false);expect(scope.job).toBe(null);expect(scope.message).toContain('score stays unchanged');
 expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/daily/'+date+'/garmin','POST',{refresh:true}]);
 expect(mutate.mock.calls.some(([path])=>path.includes('recalculate'))).toBe(false);
});
it('bounds status checks, continues the same job and sends explicit cancellation',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(path:string)=>path.includes('/garmin/jobs/')?queued:day);mutate.mockResolvedValue(queued);
 await mount();await act(async()=>scope.refresh());await act(async()=>{await vi.advanceTimersByTimeAsync(125000)});
 expect(read.mock.calls.filter(([path])=>path==='/garmin/jobs/'+id)).toHaveLength(24);expect(scope.busy).toBe(false);expect(scope.message).toContain('paused');
 await act(async()=>scope.refresh());expect(mutate).toHaveBeenCalledTimes(1);
 await act(async()=>scope.cancel());expect(mutate.mock.calls[1].slice(0,3)).toEqual(['/garmin/jobs/'+id+'/cancel','POST',{}]);
 await act(async()=>tree!.unmount());tree=null;expect(vi.getTimerCount()).toBe(0);
});
it('resumes a persisted active job without enqueueing on navigation',async()=>{
 read.mockResolvedValue({...day,activeJob:queued});await mount();expect(scope.job?.id).toBe(id);expect(mutate).not.toHaveBeenCalled();
});
