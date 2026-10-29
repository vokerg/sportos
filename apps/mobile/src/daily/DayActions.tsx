import React,{useLayoutEffect,useRef,useState} from 'react';
import {ActivityIndicator,Modal,Platform,Pressable,Text,View} from 'react-native';
import type {NativeStackHeaderItemMenu,NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStack} from '../navigation/routes';
import {useSportosTheme} from '../ui/theme';
import type {useDayActions} from './day-actions';
import type {useGarminDay} from './GarminDayCard';
import {ManualFactsSheet} from './ManualFactsSheet';

type Actions=ReturnType<typeof useDayActions>;
type Garmin=ReturnType<typeof useGarminDay>;
export function dayMenu(a:Actions,g:Garmin,ready:boolean):NativeStackHeaderItemMenu{
 const disabled=a.busy||g.busy||!ready||!!a.editor;
 const pending=!!a.pending||a.uncertain;
 return {
  type:'menu',label:'Day actions',accessibilityLabel:'Day actions',accessibilityHint:'Refresh sources, recalculate or edit this day',
  icon:{type:'sfSymbol',name:'ellipsis'},
  menu:{items:[
   {type:'submenu',label:'Sources',inline:true,items:[
    {type:'action',label:pending?'Check Strava Refresh':'Refetch Strava',icon:{type:'sfSymbol',name:'arrow.triangle.2.circlepath'},
     description:a.connection?.status==='connected'?'Activities + score':a.connectionLoaded?'Connect on the website':'Check connection',
     disabled:disabled||(a.connectionLoaded&&a.connection?.status!=='connected'),onPress:()=>a.connectionLoaded?a.refreshStrava():a.loadConnection()},
    {type:'action',label:'Refresh Garmin',icon:{type:'sfSymbol',name:'arrow.clockwise'},
     description:g.data?.fetchEnabled?'Evidence only':'Unavailable on this server',
     disabled:disabled||!g.data?.fetchEnabled,onPress:g.refresh},
   ]},
   {type:'submenu',label:'Daily facts',inline:true,items:[
    {type:'action',label:'Recalculate Score',icon:{type:'sfSymbol',name:'sum'},description:'From retained activities',disabled:disabled||pending,onPress:a.recalculate},
    {type:'action',label:'Edit Facts…',icon:{type:'sfSymbol',name:'square.and.pencil'},description:'Manual entry',disabled:disabled||pending,onPress:a.openEditor},
   ]},
  ]},
 };
}

export function DayActions({actions:a,garmin:g,ready,navigation,date}:{actions:Actions;garmin:Garmin;ready:boolean;navigation:NativeStackNavigationProp<RootStack,'DailyDetail'>;date:string}){
 const {palette}=useSportosTheme();const [fallback,setFallback]=useState(false);
 const menu=dayMenu(a,g,ready);const current=useRef(menu);current.current=menu;
 // Native header options update for capability/workflow changes. Delegates always
 // read current callbacks, including after background cancellation or a draft edit.
 const signature=JSON.stringify(menu.menu.items,(_key,value)=>typeof value==='function'?undefined:value);
 useLayoutEffect(()=>{
  const latest=()=>({...current.current,menu:{...current.current.menu,items:current.current.menu.items.map((section,index)=>section.type==='submenu'?{
   ...section,items:section.items.map((item,itemIndex)=>({...item,onPress:()=>{
    const group=current.current.menu.items[index];
    const command=group.type==='submenu'?group.items[itemIndex]:null;
    if(command?.type==='action'&&!command.disabled)command.onPress();
   }})),
  }:section)}});
  navigation.setOptions(Platform.OS==='ios'?{unstable_headerRightItems:()=>[latest()]}:{headerRight:()=>
   <Pressable accessibilityRole="button" accessibilityLabel="Day actions" onPress={()=>setFallback(true)} style={{minWidth:44,minHeight:44,justifyContent:'center',alignItems:'center'}}><Text style={{color:palette.accent,fontSize:26}}>•••</Text></Pressable>});
 },[navigation,signature,palette.accent]);
 const status=a.error||a.message;
 return <>
  {(a.busy||status)?<View accessibilityLiveRegion="polite" style={{flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:4}}>
   {a.busy?<ActivityIndicator color={palette.accent}/>:null}
   <Text accessibilityRole={a.error?'alert':'text'} style={{flex:1,color:a.error?palette.warning:palette.muted,fontSize:13,lineHeight:19}}>{status||(a.editor?'Saving facts…':'Checking day data…')}</Text>
  </View>:null}
  <ManualFactsSheet actions={a} date={date}/>
  {Platform.OS!=='ios'?<Modal visible={fallback} transparent animationType="fade" onRequestClose={()=>setFallback(false)}>
   <Pressable accessibilityRole="button" accessibilityLabel="Dismiss day actions" onPress={()=>setFallback(false)} style={{flex:1,backgroundColor:'#00000055',justifyContent:'flex-end'}}>
    <View style={{backgroundColor:palette.surface,padding:24,borderTopLeftRadius:24,borderTopRightRadius:24,gap:8}}>
     <Text accessibilityRole="header" style={{color:palette.text,fontSize:20,fontWeight:'600'}}>Day actions</Text>
     {menu.menu.items.flatMap(group=>group.type==='submenu'?group.items:[]).map(item=>item.type==='action'?<Pressable key={item.label} accessibilityRole="button" accessibilityState={{disabled:item.disabled}} disabled={item.disabled} onPress={()=>{setFallback(false);item.onPress()}} style={{paddingVertical:14,opacity:item.disabled?0.4:1}}>
      <Text style={{color:palette.text,fontSize:16}}>{item.label}</Text><Text style={{color:palette.muted,fontSize:12}}>{item.description}</Text>
     </Pressable>:null)}
    </View>
   </Pressable>
  </Modal>:null}
 </>;
}
