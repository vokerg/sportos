import React,{useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,expect,it,vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const {read,mutate}=vi.hoisted(()=>({read:vi.fn(),mutate:vi.fn()}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(effect:()=>void)=>useEffect(effect,[effect])}));
vi.mock('../src/auth/SessionProvider',()=>({useSession:()=>({read,mutate})}));
vi.mock('../src/ui/primitives',()=>{const Container=({children}:{children:React.ReactNode})=><>{children}</>;return {Card:Container,Body:Container,Action:(p:object)=>React.createElement('Action',p)}});
import {CalculateAllCard} from '../src/daily/CalculateAllCard';
import {calculationJob,calculationState} from '../src/daily/calculation-model';
const job={id:'00000000-0000-4000-8000-000000000002',from:'2026-11-13',to:'2026-11-13',nextDate:'2026-11-13',processedDays:0,totalDays:1,status:'queued',errorCode:null,attemptCount:0};
const done={...job,status:'succeeded',processedDays:1,nextDate:'2026-11-14'};
const state={cursor:{startDate:'2026-11-04',completedThrough:'2026-11-12',timeZone:'Europe/Copenhagen'},nextDate:'2026-11-13',activeJob:null,latestJob:null};
let tree:ReactTestRenderer|null=null;
async function mount(callback=vi.fn()){await act(async()=>{tree=create(<CalculateAllCard onCalculated={callback}/>)});return callback}
const button=(title:string)=>tree!.root.findByProps({title});
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=null;vi.clearAllMocks();vi.useRealTimers()});
it('reads without scoring on navigation and permits ten completed calculations today',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>p==='/daily/recalculation'?state:done);mutate.mockResolvedValue(job);const finished=await mount();expect(mutate).not.toHaveBeenCalled();
 for(let i=0;i<10;i++){
  await act(async()=>{const action=button('Calculate all');action.props.onPress();action.props.onPress()});expect(mutate).toHaveBeenCalledTimes(i+1);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(button('Calculate all').props.disabled).toBe(false);
 }
 expect(finished).toHaveBeenCalledTimes(10);expect(mutate.mock.calls.every(([p,m,b])=>p==='/daily/recalculation'&&m==='POST'&&Object.keys(b).length===0)).toBe(true);
});
it('recovers active work on reopening and supports independent cancellation without another scoring POST',async()=>{
 vi.useFakeTimers();read.mockImplementationOnce(async()=>({...state,activeJob:job})).mockImplementation(async(p:string)=>p==='/daily/recalculation'?{...state,latestJob:{...job,status:'cancelled'}}:{...job,status:'cancelled'});mutate.mockResolvedValue({...job,status:'cancelled'});await mount();expect(mutate).not.toHaveBeenCalled();
 await act(async()=>{button('Cancel calculation').props.onPress()});expect(mutate.mock.calls[0][0]).toBe('/daily/recalculation/jobs/'+job.id+'/cancel');
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});expect(button('Retry calculation')).toBeTruthy();
});
it('requires status recovery after an ambiguous submission and never displays private errors',async()=>{
 read.mockResolvedValue(state);mutate.mockRejectedValue(new Error('private database content'));await mount();await act(async()=>{button('Calculate all').props.onPress()});expect(button('Calculate all').props.disabled).toBe(true);
 expect(JSON.stringify(tree!.toJSON())).not.toContain('private database content');await act(async()=>{button('Check calculation status').props.onPress()});expect(button('Calculate all').props.disabled).toBe(false);
});
it('bounds polling and cancels transport/timers on teardown without cancelling the server job',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>p==='/daily/recalculation'?state:job);mutate.mockResolvedValue(job);await mount();await act(async()=>{button('Calculate all').props.onPress()});await act(async()=>{await vi.advanceTimersByTimeAsync(125000)});
 expect(read.mock.calls.filter(([p])=>p.includes('/jobs/'))).toHaveLength(24);expect(button('Check calculation job')).toBeTruthy();await act(async()=>{button('Check calculation job').props.onPress()});await act(async()=>tree!.unmount());tree=null;expect(vi.getTimerCount()).toBe(0);expect(mutate).toHaveBeenCalledTimes(1);
});
it('allowlists transport fields and rejects corrupt calendar/progress responses',()=>{
 expect(calculationJob({...job,owner_id:'private',lease_owner:'private'})).not.toHaveProperty('owner_id');expect(calculationState({...state,prompt:'private'})).not.toHaveProperty('prompt');
 for(const invalid of [{...job,totalDays:4000},{...job,processedDays:2},{...job,from:'2026-02-30'},{...job,errorCode:'private message'}])expect(()=>calculationJob(invalid)).toThrow();
});
