import React from 'react';
import {StyleSheet,Text,View} from 'react-native';
import Svg,{Path} from 'react-native-svg';
import {useSportosTheme} from './theme';
export function ProviderLogo({provider,compact=false,muted=false}:{provider:'garmin'|'strava';compact?:boolean;muted?:boolean}){
 const {palette}=useSportosTheme();
 return <View style={styles.brand} accessible={false}>
  {provider==='strava'?<Svg width={compact?16:24} height={compact?16:24} viewBox="0 0 24 24"><Path d="M9 2L1 16h5l3-5 3 5h5L9 2zM17 22l6-10h-4l-2 4-2-4h-4l6 10z" fill={muted?palette.muted:"#FC4C02"}/></Svg>:<Svg width={compact?15:20} height={compact?15:20} viewBox="0 0 20 20"><Path d="M10 2l9 16H1L10 2z" fill={muted?palette.muted:"#168AC0"}/></Svg>}
  {!compact?<Text style={{color:palette.text,fontSize:12,fontWeight:'800',letterSpacing:provider==='garmin'?1:0}}>{provider==='garmin'?'GARMIN':'STRAVA'}</Text>:null}
 </View>;
}
/** Presence is distinct from freshness. Undefined means the API did not report coverage. */
export function ProviderStatus({sources,compact=false}:{sources?:{strava?:boolean;garmin?:boolean};compact?:boolean}){
 const {palette}=useSportosTheme();
 return <View style={compact?{flexDirection:'row',gap:8,alignItems:'center'}:styles.row}>{(['strava','garmin'] as const).map(provider=>{
  const present=sources?.[provider];const status=present===true?'Data loaded':present===false?'No data':'Not checked';
  return <View key={provider} accessible accessibilityLabel={`${provider==='strava'?'Strava':'Garmin'}: ${status}`} style={compact?{flexDirection:'row',alignItems:'center',gap:2}: [styles.pill,{backgroundColor:palette.soft}]}>
   <ProviderLogo provider={provider} compact={compact} muted={compact&&present!==true}/>{compact?<Text style={{color:present===true?palette.accent:palette.muted,fontSize:9}}>{present===true?'•':present===false?'–':'?'}</Text>:<View style={styles.status}><View style={{width:5,height:5,borderRadius:3,backgroundColor:present===true?palette.accent:palette.muted}}/><Text style={{color:palette.muted,fontSize:11}}>{status}</Text></View>}
  </View>;
 })}</View>;
}
const styles=StyleSheet.create({row:{flexDirection:'row',flexWrap:'wrap',gap:10},pill:{paddingHorizontal:12,paddingVertical:10,borderRadius:14,gap:7,minWidth:120,flexGrow:1},brand:{flexDirection:'row',alignItems:'center',gap:6},status:{flexDirection:'row',alignItems:'center',gap:6}});
