import React from 'react';
import {Text,View,StyleSheet} from 'react-native';
import {useSportosTheme} from '../ui/theme';
import {ProviderStatus} from '../ui/ProviderStatus';
import {formatPoints,scoreAuthority} from './model.mjs';
import type {MobileDayDetail} from './contracts';
export function DayScoreCard({data,sources,today}:{data:MobileDayDetail;sources:{strava?:boolean;garmin?:boolean};today:boolean}){
 const {palette}=useSportosTheme();
 return <View style={[styles.card,{backgroundColor:palette.hero}]}>
  <View style={styles.top}><Text style={[styles.caption,{color:palette.heroMuted}]}>DAILY SCORE</Text><Text style={{color:palette.heroMuted,fontSize:12}}>{today?'Today so far':scoreAuthority(data.status)}</Text></View>
  <View style={styles.scoreRow}><Text accessibilityLabel={formatPoints(data.score.appTotal)+' points'} adjustsFontSizeToFit minimumFontScale={0.5} numberOfLines={1} maxFontSizeMultiplier={1.4} style={[styles.score,{color:palette.heroText}]}>{formatPoints(data.score.appTotal)}</Text><Text style={[styles.caption,{color:palette.lime}]}>POINTS</Text></View>
  {today?<Text style={{color:palette.lime,fontSize:12}}>{scoreAuthority(data.status)}</Text>:null}
  <View style={[styles.metrics,{borderColor:palette.heroMuted+'40'}]}>
   {[['Base',data.score.baseTotal],['Bonus',data.score.bonusPoints],...(data.score.excelTotal!==null?[['Original Excel',data.score.excelTotal]]:[]),...(data.score.delta!==null?[['Difference',data.score.delta]]:[])].map(([label,value])=><View key={label} style={{gap:4,minWidth:80,flexGrow:1}}><Text style={{color:palette.heroText,fontSize:22,fontWeight:'600',fontVariant:['tabular-nums']}}>{formatPoints(Number(value),label==='Bonus'||label==='Difference')}</Text><Text style={{color:palette.heroMuted,fontSize:12}}>{label}</Text></View>)}
  </View>
  <View style={{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:10,backgroundColor:palette.surface,paddingHorizontal:12,paddingVertical:10,borderRadius:12}}><Text style={{color:palette.muted,fontSize:12}}>Retained sources</Text><ProviderStatus sources={sources} compact/></View>
 </View>;
}
const styles=StyleSheet.create({
 card:{padding:24,borderRadius:26,borderCurve:'continuous',gap:14},top:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'space-between',gap:8},
 caption:{fontSize:10,letterSpacing:1.4,fontWeight:'700'},scoreRow:{flexDirection:'row',alignItems:'baseline',gap:10},score:{fontSize:58,fontWeight:'700',letterSpacing:-2.5,fontVariant:['tabular-nums'],flexShrink:1},
 metrics:{borderTopWidth:StyleSheet.hairlineWidth,paddingTop:16,flexDirection:'row',flexWrap:'wrap',gap:20},
});
