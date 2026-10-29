import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { TrackArt, SportGlyph } from '../ui/identity';
import { useSportosTheme } from '../ui/theme';
import type { DailySummary } from './contracts';
import { formatPoints, scoreAuthority, sourceNames, todayCoverage } from './model.mjs';

export function ScoreHero({ day, today, onOpen }: { day: DailySummary; today: string; onOpen(): void }) {
  const { palette } = useSportosTheme();
  const { fontScale } = useWindowDimensions();
  return <View style={[styles.hero,{backgroundColor:palette.hero}]}>
    <TrackArt/>
    <View style={styles.top}>
      <Text accessibilityRole="header" style={[styles.label,{color:palette.heroMuted}]}>{day.metric_date===today?"TODAY'S SAVED SCORE":'LATEST SAVED SCORE'}</Text>
      <View style={styles.date}><Text style={{color:palette.heroText,fontSize:11,fontWeight:'600'}}>{day.metric_date}</Text></View>
    </View>
    <View style={styles.scoreRow}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} maxFontSizeMultiplier={1.25} style={[styles.score,{color:palette.heroText}]}>{formatPoints(day.total_points)}</Text>
      <Text style={[styles.unit,{color:palette.lime}]}>POINTS</Text>
    </View>
    <Text style={[styles.authority,{color:palette.lime}]}>{scoreAuthority(day.score_status)}</Text>
    <View style={styles.metrics}>
      {[['30-day average',formatPoints(day.avg_30d)],['Base',formatPoints(day.base_points)],['Bonus',formatPoints(day.bonus_points,true)]].map(([label,value])=>
        <View key={label} style={[styles.metric,fontScale>1.3?{flexBasis:'100%'}:null]}><Text style={[styles.metricValue,{color:palette.heroText}]}>{value}</Text>
          <Text style={[styles.metricLabel,{color:palette.heroMuted}]}>{label}</Text></View>)}
    </View>
    <Text style={[styles.note,{color:palette.heroMuted}]}>{todayCoverage(day.metric_date,today)}{'\n'}{sourceNames(day.providerSources)}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="Review this day" onPress={onOpen}
      style={({pressed})=>[styles.button,{backgroundColor:palette.lime,opacity:pressed?0.8:1}]}>
      <Text style={{color:'#1B3025',fontSize:15,fontWeight:'700'}}>Review this day</Text><SportGlyph sport="arrow" color="#1B3025" size={20}/>
    </Pressable>
  </View>;
}
const styles=StyleSheet.create({
  hero:{borderRadius:28,padding:24,gap:16,overflow:'hidden',borderCurve:'continuous'},
  top:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',gap:10,justifyContent:'space-between'},
  label:{fontSize:10,fontWeight:'700',letterSpacing:1.5},date:{backgroundColor:'#FFFFFF12',borderRadius:7,paddingHorizontal:8,paddingVertical:6},
  scoreRow:{flexDirection:'row',flexWrap:'wrap',alignItems:'baseline',columnGap:10,marginTop:4},
  score:{fontSize:64,fontWeight:'800',letterSpacing:-3,fontVariant:['tabular-nums'],flexShrink:1,maxWidth:'100%'},unit:{fontSize:10,fontWeight:'700',letterSpacing:1.6},
  authority:{fontSize:12,fontWeight:'600'},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:18,borderTopWidth:1,borderColor:'#FFFFFF20',paddingTop:20,marginTop:4},
  metric:{minWidth:70,flex:1,gap:5},metricValue:{fontSize:23,fontWeight:'700',letterSpacing:-0.5,fontVariant:['tabular-nums']},metricLabel:{fontSize:11,lineHeight:16},
  note:{fontSize:11,lineHeight:17},button:{minHeight:48,borderRadius:14,padding:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
});
