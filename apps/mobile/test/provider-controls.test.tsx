import React,{useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,expect,it,vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const {read,mutate}=vi.hoisted(()=>({read:vi.fn(),mutate:vi.fn()}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(effect:()=>void)=>useEffect(effect,[effect])}));
vi.mock('../src/auth/SessionProvider',()=>({useSession:()=>({read,mutate})}));
vi.mock('../src/ui/ProviderStatus',()=>({ProviderLogo:()=>null}));
vi.mock('../src/ui/theme',()=>({useSportosTheme:()=>({palette:{}})}));
vi.mock('react-native',()=>({Text:'Text',View:'View'}));
vi.mock('../src/ui/primitives',()=>{
 const Container=({children}: {children:React.ReactNode})=><>{children}</>;
 return{Screen:Container,Card:Container,Body:Container,Action:(p:object)=>React.createElement('Action',p),SourceBadge:(p:object)=>React.createElement('Badge',p),StatusPanel:(p:object)=>React.createElement('Status',p)};
});
import {ProvidersScreen} from '../src/providers/screens';
import {GarminDayCard} from '../src/daily/GarminDayCard';
import {connections,garminDay,job} from '../src/providers/model';
import {useOperation} from '../src/providers/use-operation';
const id='00000000-0000-4000-8000-000000000001';const jobId='00000000-0000-4000-8000-000000000002';
const connection={id,provider:'strava',status:'connected',lastSyncAt:null};
const queued={id:jobId,connectionId:id,status:'queued',phase:'queued',progressPercent:0,attemptCount:0,maxAttempts:3};
const day={date:'2026-10-29',origin:'garmin_connect',evidenceOnly:true,fetchEnabled:true,state:'partial',completeness:'in_progress',categories:[{category:'summary',state:'rate_limited',retainedState:'available',retainedAt:'2026-10-29T08:00:00Z'}]};
let tree:ReactTestRenderer|null=null;
async function mount(element:React.ReactElement){await act(async()=>{tree=create(element)});return tree!}
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=null;vi.clearAllMocks();vi.useRealTimers()});
const button=(title:string)=>tree!.root.findByProps({title});
it('projects minimal owner-free provider state and rejects foreign jobs or corrupt day responses',()=>{
 expect(connections([{...connection,token:'secret',owner:'private',scopes:['private']}])).toEqual([{id,status:'connected',lastSyncAt:null}]);
 expect(()=>job({...queued,connectionId:jobId},id)).toThrow();
 expect(job({...queued,result:{private:'raw'},error:{message:'private'}},id)).not.toHaveProperty('result');
 expect(garminDay({...day,categories:[{...day.categories[0],evidence:{private:'raw'}}]},day.date).categories[0]).not.toHaveProperty('evidence');
 expect(()=>garminDay(day,'2026-10-28')).toThrow();expect(()=>garminDay({...day,fetchEnabled:'true'},day.date)).toThrow();
});
it('submits one incremental sync, polls the job to success and never downloads Garmin',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>p==='/providers/connections'?[connection]:p.includes('/jobs?')?[]:{...queued,status:'succeeded',progressPercent:100});
 let finish!:(v:unknown)=>void;mutate.mockImplementation(()=>new Promise(r=>{finish=r}));
 await mount(<ProvidersScreen/>);
 const submit=button('Sync changes');await act(async()=>{submit.props.onPress();submit.props.onPress()});
 expect(mutate).toHaveBeenCalledTimes(1);expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/providers/connections/'+id+'/sync','POST',{mode:'incremental'}]);
 await act(async()=>finish(queued));await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});
 expect(read.mock.calls.some(([p])=>p==='/providers/jobs/'+jobId)).toBe(true);
 expect(tree!.root.findByType('Badge' as never)).toBeTruthy();
 expect(read.mock.calls.some(([p])=>p.includes('garmin'))).toBe(false);
});
it('stops job polling after its budget and removes the wait on unmount',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>p==='/providers/connections'?[connection]:p.includes('/jobs?')?[queued]:queued);
 await mount(<ProvidersScreen/>);await act(async()=>{await vi.advanceTimersByTimeAsync(125000)});
 expect(read.mock.calls.filter(([p])=>p==='/providers/jobs/'+jobId)).toHaveLength(24);
 await act(async()=>{await vi.advanceTimersByTimeAsync(30000)});
 expect(read.mock.calls.filter(([p])=>p==='/providers/jobs/'+jobId)).toHaveLength(24);
 await act(async()=>{button('Refresh sync status').props.onPress()});
 await act(async()=>tree!.unmount());tree=null;expect(vi.getTimerCount()).toBe(0);
});
it('uses server capability for Garmin and reads compact evidence only',async()=>{
 read.mockResolvedValue({...day,fetchEnabled:false});await mount(<GarminDayCard date={day.date}/>);
 expect(tree!.root.findAllByProps({title:'Load Garmin'})).toHaveLength(0);
 expect(mutate).not.toHaveBeenCalled();expect(read.mock.calls.map(([p])=>p)).toEqual(['/daily/'+day.date+'/garmin']);
});
it('refreshes Garmin explicitly with duplicate protection and keeps partial category status',async()=>{
 read.mockResolvedValue(day);let finish!:(v:unknown)=>void;mutate.mockImplementation(()=>new Promise(r=>{finish=r}));await mount(<GarminDayCard date={day.date}/>);
 const refresh=button('Load Garmin');await act(async()=>{refresh.props.onPress();refresh.props.onPress()});expect(mutate).toHaveBeenCalledTimes(1);
 expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/daily/'+day.date+'/garmin','POST',{refresh:false}]);
 await act(async()=>finish(day));expect(JSON.stringify(tree!.toJSON())).not.toContain('retained');
 expect(mutate.mock.calls.some(([p])=>p.includes('recalculate'))).toBe(false);
});
it('aborts route requests and discards late results after unmount',async()=>{
 let scope!:ReturnType<typeof useOperation>;let finish!:(v:unknown)=>void;const accept=vi.fn();read.mockImplementation(()=>new Promise(r=>{finish=r}));
 function Probe(){scope=useOperation();return null}await mount(<Probe/>);
 let pending!:Promise<void>;await act(async()=>{pending=scope.run(api=>api.read('/providers/connections'),accept,'failed')});
 const signal=read.mock.calls[0][1] as AbortSignal;await act(async()=>tree!.unmount());tree=null;expect(signal.aborted).toBe(true);
 await act(async()=>{finish([]);await pending});expect(accept).not.toHaveBeenCalled();
});
it('sends cancel and retry to the current job, never to another connection',async()=>{
 read.mockImplementation(async(p:string)=>p==='/providers/connections'?[connection]:[queued]);mutate.mockResolvedValue({...queued,status:'cancelled'});await mount(<ProvidersScreen/>);
 await act(async()=>{button('Cancel sync').props.onPress()});expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/providers/jobs/'+jobId+'/cancel','POST',{}]);
 mutate.mockResolvedValue(queued);await act(async()=>{button('Retry sync').props.onPress()});expect(mutate.mock.calls[1].slice(0,3)).toEqual(['/providers/jobs/'+jobId+'/retry','POST',{}]);
});
it('requires status reload after an ambiguous sync timeout',async()=>{
 read.mockImplementation(async(p:string)=>p==='/providers/connections'?[connection]:[]);mutate.mockRejectedValue(new Error('private provider response'));await mount(<ProvidersScreen/>);
 await act(async()=>{button('Sync changes').props.onPress()});expect(button('Sync changes').props.disabled).toBe(true);
 expect(JSON.stringify(tree!.toJSON())).not.toContain('private provider response');
 await act(async()=>{button('Refresh sync status').props.onPress()});expect(button('Sync changes').props.disabled).toBe(false);
});
it('discards a Garmin fetch result when the displayed date changes',async()=>{
 read.mockImplementation(async(p:string)=>({...day,date:p.split('/')[2]}));let finish!:(v:unknown)=>void;mutate.mockImplementation(()=>new Promise(r=>{finish=r}));await mount(<GarminDayCard date={day.date}/>);
 await act(async()=>{button('Load Garmin').props.onPress()});const signal=mutate.mock.calls[0][3] as AbortSignal;
 // Day-detail keys the card by date, so replacement must abort the old route-bound operation.
 await act(async()=>{tree!.update(<GarminDayCard key="next" date="2026-10-28"/>)});expect(signal.aborted).toBe(true);
 await act(async()=>{finish({...day,state:'current',completeness:'complete'})});expect(JSON.stringify(tree!.toJSON())).not.toContain('retained');
});
