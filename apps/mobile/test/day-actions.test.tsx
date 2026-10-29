import React,{useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,expect,it,vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const {read,mutate}=vi.hoisted(()=>({read:vi.fn(),mutate:vi.fn()}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(effect:()=>void)=>useEffect(effect,[effect])}));
vi.mock('../src/auth/SessionProvider',()=>({useSession:()=>({read,mutate})}));
vi.mock('../src/ui/theme',()=>({useSportosTheme:()=>({palette:{}})}));
vi.mock('../src/ui/identity',()=>({SportMark:()=>null}));
vi.mock('../src/ui/ProviderStatus',()=>({ProviderLogo:()=>null,ProviderStatus:()=>null}));
vi.mock('react-native-safe-area-context',()=>({SafeAreaView:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('react-native',()=>({Platform:{OS:'ios'},ActivityIndicator:'Spinner',Modal:({visible,children}:{visible:boolean;children:React.ReactNode})=>visible?<>{children}</>:null,ScrollView:'ScrollView',Text:'Text',TextInput:'Input',Switch:'Switch',Pressable:'Pressable',View:'View',StyleSheet:{create:(s:unknown)=>s}}));
vi.mock('../src/ui/primitives',()=>{
 const Container=({children}: {children:React.ReactNode})=><>{children}</>;
 return{Screen:(p:object)=>React.createElement('Screen',p),Card:Container,Body:Container,Metric:()=>null,Action:(p:object)=>React.createElement('Action',p),StatusPanel:Container,formatDistance:String};
});
import {factsDraft,parseDraft,stravaDayWindow,useDayActions} from '../src/daily/day-actions';
import {DailyDetailScreen} from '../src/daily/screens';
const date='2026-10-29';
const id='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002';
const connection={id,provider:'strava',status:'connected',lastSyncAt:null};
const queued={id:jobId,connectionId:id,status:'queued',progressPercent:0};
const facts={steps:100,runOutdoorM:1234,runIndoorM:500,runUnspecifiedM:10,bikeOutdoorM:20000,bikeIndoorM:0,bikeUnspecifiedM:25,swimM:500,workoutPoints:300,bonusPoints:400};
const breakdown={date,recomputedAt:'2026-10-29T00:00:00Z',scoreStatus:'calculated',facts:{...facts,runM:1744,bikeM:20025},score:{appTotal:1000,baseTotal:600,bonusPoints:400,ledgerTotal:1000,excelTotal:null,delta:null},ledger:[],activities:[]};
let tree:ReactTestRenderer|null=null;let scope!:ReturnType<typeof useDayActions>;
const updated=vi.fn();
const navigation={setOptions:vi.fn()};
function menuItems(){const opts=navigation.setOptions.mock.calls.at(-1)![0];return opts.unstable_headerRightItems()[0].menu.items.flatMap((group:{items:unknown[]})=>group.items)}
const menuItem=(label:string)=>menuItems().find((item:{label:string})=>item.label===label);
function Probe(){scope=useDayActions(date,updated);return null}
async function mount(element=<Probe/>){await act(async()=>{tree=create(element)})}
afterEach(async()=>{if(tree)await act(async()=>tree!.unmount());tree=null;vi.resetAllMocks();vi.useRealTimers()});
function defaultReads(path:string):unknown{
 if(path==='/providers/connections')return [connection];
 if(path.includes('manual-facts'))return [{date,facts}];
 if(path.endsWith('/garmin'))return {date,origin:'garmin_connect',evidenceOnly:true,fetchEnabled:true,state:'missing',completeness:'in_progress',categories:[]};
 if(path.startsWith('/daily/summary'))return [];
 return {...queued,status:'succeeded',progressPercent:100};
}
it('keeps all four actions in a native menu on an empty day with no button stack or navigation writes',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));
 await mount(<DailyDetailScreen route={{params:{date}} as never} navigation={navigation as never}/>);
 for(const label of ['Refetch Strava','Refresh Garmin','Recalculate Score','Edit Facts…'])expect(menuItem(label).disabled).toBe(false);
 expect(tree!.root.findAllByProps({title:'Recalculate from activities'})).toHaveLength(0);
 expect(tree!.root.findAllByType('Input' as never)).toHaveLength(0);
 expect(mutate).not.toHaveBeenCalled();
});
it('waits for targeted sync success before recalculation and prevents double submissions',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>defaultReads(p));
 let finish!:(v:unknown)=>void;
 mutate.mockImplementation((p:string)=>p.endsWith('/sync')?new Promise(r=>{finish=r}):Promise.resolve(breakdown));
 await mount();await act(async()=>{scope.refreshStrava();scope.refreshStrava()});
 expect(mutate).toHaveBeenCalledTimes(1);
 expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/providers/connections/'+id+'/sync','POST',{mode:'webhook_refresh',...stravaDayWindow(date)}]);
 await act(async()=>finish(queued));expect(mutate).toHaveBeenCalledTimes(1);
 await act(async()=>{await vi.advanceTimersByTimeAsync(5000)});
 expect(mutate.mock.calls[1].slice(0,3)).toEqual(['/daily/'+date+'/recalculate','POST',{}]);
 expect(updated).toHaveBeenCalledTimes(1);expect(scope.pending).toBe(null);
});
it('does not recalculate a failed sync and keeps the score on recalculation failure',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));mutate.mockResolvedValue({...queued,status:'failed'});
 await mount();await act(async()=>scope.refreshStrava());expect(mutate).toHaveBeenCalledTimes(1);expect(updated).not.toHaveBeenCalled();
 mutate.mockRejectedValue(new Error('private provider payload'));await act(async()=>scope.recalculate());
 expect(updated).not.toHaveBeenCalled();expect(scope.error).not.toContain('private provider');
});
it('caps polling, resumes the same job and cancels timers and late results on unmount',async()=>{
 vi.useFakeTimers();read.mockImplementation(async(p:string)=>p==='/providers/connections'?[connection]:queued);mutate.mockResolvedValue(queued);
 await mount();await act(async()=>scope.refreshStrava());await act(async()=>{await vi.advanceTimersByTimeAsync(125000)});
 expect(read.mock.calls.filter(([p])=>p==='/providers/jobs/'+jobId)).toHaveLength(24);expect(scope.busy).toBe(false);expect(scope.pending?.id).toBe(jobId);
 await act(async()=>scope.refreshStrava());expect(mutate).toHaveBeenCalledTimes(1);
 await act(async()=>tree!.unmount());tree=null;expect(vi.getTimerCount()).toBe(0);expect(updated).not.toHaveBeenCalled();
});
it('recovers an ambiguous enqueue by exact range instead of submitting twice',async()=>{
 read.mockImplementation(async(p:string)=>p.includes('/jobs?')?[{...queued,mode:'webhook_refresh',requestedAfter:stravaDayWindow(date).after,requestedBefore:stravaDayWindow(date).before,createdAt:new Date().toISOString(),status:'succeeded'}]:defaultReads(p));
 mutate.mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(breakdown);
 await mount();await act(async()=>scope.refreshStrava());expect(scope.uncertain).toBe(true);
 await act(async()=>scope.refreshStrava());expect(mutate.mock.calls.filter(([p])=>p.endsWith('/sync'))).toHaveLength(1);
 expect(updated).toHaveBeenCalledTimes(1);
});
it('prefills every subtype, validates manual values and saves with PUT using server authority',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));mutate.mockResolvedValue({...breakdown,scoreStatus:'manual'});
 await mount();await act(async()=>scope.openEditor());expect(scope.editor?.draft.runOutdoorM).toBe('1.234');
 await act(async()=>scope.setEditor(current=>({...current!,draft:{...current!.draft,steps:'-1'}})));
 await act(async()=>scope.save());expect(mutate).not.toHaveBeenCalled();expect(scope.validation).toBeTruthy();
 await act(async()=>scope.setEditor(current=>({...current!,draft:{...current!.draft,steps:'200'},totalSteps:true})));
 await act(async()=>{scope.save();scope.save()});
 expect(mutate).toHaveBeenCalledTimes(1);expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/daily/'+date+'/facts','PUT',{...facts,steps:200,totalSteps:200}]);
 expect(scope.editor).toBe(null);expect(updated.mock.calls[0][0].status).toBe('manual');
});
it('retains unsaved manual edits on failure and cannot apply a late save to a replacement date',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));mutate.mockRejectedValueOnce(new Error('offline'));
 await mount();await act(async()=>scope.openEditor());await act(async()=>scope.save());expect(scope.editor).not.toBe(null);
 let finish!:(v:unknown)=>void;mutate.mockImplementation(()=>new Promise(r=>{finish=r}));await act(async()=>scope.save());
 const signal=mutate.mock.calls[1][3];await act(async()=>tree!.unmount());tree=null;expect(signal.aborted).toBe(true);
 await act(async()=>finish(breakdown));expect(updated).not.toHaveBeenCalled();
});
it('bounds dates, numeric input and all-day steps without calculating official scores',()=>{
 expect(()=>stravaDayWindow('2026-02-30')).toThrow();
 expect(stravaDayWindow('2026-10-25')).toEqual({after:'2026-10-24T09:00:00.000Z',before:'2026-10-26T12:00:00.000Z'});
 const {draft}=factsDraft(facts);expect(parseDraft({...draft,runOutdoorM:'1,234'},false)).toEqual(facts);
 for(const value of ['NaN','Infinity','1e10','-1','10000001',''])expect(()=>parseDraft({...draft,steps:value},false)).toThrow();
 expect(()=>parseDraft({...draft,bonusPoints:'1.5'},false)).toThrow();
});
it('uses the top Garmin action without recalculation and explains unavailable capabilities',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));mutate.mockResolvedValue({id:jobId,operation:'day',date,activityId:null,refresh:true,status:'succeeded',phase:'succeeded',attemptCount:1,errorCode:null});
 await mount(<DailyDetailScreen route={{params:{date}} as never} navigation={navigation as never}/>);
 await act(async()=>menuItem('Refresh Garmin').onPress());
 expect(mutate.mock.calls[0].slice(0,3)).toEqual(['/daily/'+date+'/garmin','POST',{refresh:true}]);
 expect(mutate).toHaveBeenCalledTimes(1);
 await act(async()=>tree!.unmount());tree=null;
 read.mockImplementation(async(p:string)=>p.endsWith('/garmin')?{...defaultReads(p) as object,fetchEnabled:false}:p==='/providers/connections'?[]:defaultReads(p));
 await mount(<DailyDetailScreen route={{params:{date}} as never} navigation={navigation as never}/>);
 expect(menuItem('Refresh Garmin').disabled).toBe(true);
 expect(menuItem('Refetch Strava').disabled).toBe(true);
 expect(menuItem('Edit Facts…').disabled).toBe(false);
});
it('cannot enqueue another refresh when the previous submission outcome is unknown',async()=>{
 read.mockImplementation(async(p:string)=>p.includes('/jobs?')?[]:defaultReads(p));mutate.mockRejectedValue(new Error('timeout'));
 await mount();await act(async()=>scope.refreshStrava());await act(async()=>scope.refreshStrava());
 expect(mutate).toHaveBeenCalledTimes(1);expect(scope.uncertain).toBe(true);
});

it('opens a separate manual sheet from the menu and cancels without writing',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));
 await mount(<DailyDetailScreen route={{params:{date}} as never} navigation={navigation as never}/>);
 await act(async()=>menuItem('Edit Facts…').onPress());
 expect(tree!.root.findAllByType('Input' as never)).toHaveLength(6);
 expect(tree!.root.findByProps({accessibilityLabel:'Run outdoor (km)'}).props.value).toBe('1.234');
 await act(async()=>tree!.root.findByProps({accessibilityLabel:'Cancel manual entry'}).props.onPress());
 expect(tree!.root.findAllByType('Input' as never)).toHaveLength(0);expect(mutate).not.toHaveBeenCalled();
});

it('pulls saved day data and Garmin coverage without fetching providers or recalculating',async()=>{
 read.mockImplementation(async(p:string)=>defaultReads(p));
 await mount(<DailyDetailScreen route={{params:{date}} as never} navigation={navigation as never}/>);
 read.mockClear();
 await act(async()=>tree!.root.findByType('Screen' as never).props.onRefresh());
 expect(read.mock.calls.map(([path])=>path).sort()).toEqual(['/daily/'+date+'/garmin','/daily/summary?from='+date+'&to='+date+'&limit=1'].sort());
 expect(mutate).not.toHaveBeenCalled();
});
