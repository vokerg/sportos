import React, {useEffect} from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {expect,it,vi} from 'vitest';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
const {read}=vi.hoisted(()=>({read:vi.fn()}));
vi.mock('react-native',()=>({Pressable:'Pressable',Text:'Text',View:'View',StyleSheet:{create:(s:unknown)=>s}}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(effect:()=>void)=>useEffect(effect,[effect])}));
vi.mock('../src/auth/SessionProvider',()=>({useSession:()=>({read,mutate:read})}));
vi.mock('../src/auth/useScreenSession',()=>({useScreenSession:()=>({read})}));
vi.mock('../src/ui/theme',()=>({useSportosTheme:()=>({palette:{}})}));
vi.mock('../src/ui/identity',()=>({SportMark:()=>null}));
vi.mock('../src/daily/ScoreHero',()=>({ScoreHero:()=>null}));
vi.mock('../src/ui/primitives',()=>{
 const container=({children}: {children:React.ReactNode})=><>{children}</>;
 return {Screen:container,Card:container,Body:container,Metric:()=>null,Action:()=>null,DateStepper:()=>null,NavigationRow:()=>null,SourceBadge:()=>null,StatusPanel:()=>null,formatDistance:(n:number)=>String(n)};
});
import {DailyScreen} from '../src/daily/screens';
it('opens the tapped historical day on the parent detail stack instead of updating an offscreen summary',async()=>{
 const day={metric_date:'2026-10-20',score_status:'calculated',total_points:120,base_points:100,bonus_points:20,steps:100,run_m:0,bike_m:0,swim_m:0,workout_points:0,excel_all_points:null,points_delta_vs_excel:null,avg_30d:null};
 read.mockResolvedValue([day]);
 const navigate=vi.fn();const getParent=vi.fn(()=>({navigate}));let renderer!:ReactTestRenderer;
 await act(async()=>{renderer=create(<DailyScreen navigation={{getParent} as never} route={{} as never}/>)});
 const row=renderer.root.findByProps({accessibilityRole:'button',accessibilityLabel:'2026-10-20, 120 pt · Calculated score'});
 await act(async()=>{row.props.onPress()});
 expect(navigate).toHaveBeenCalledExactlyOnceWith('DailyDetail',{date:'2026-10-20'});
 await act(async()=>renderer.unmount());
});
