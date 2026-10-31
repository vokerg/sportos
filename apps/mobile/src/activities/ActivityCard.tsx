import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSportosTheme } from '../ui/theme';
import { SportMark } from '../ui/identity';
import { sourceLabel } from '../ui/source-label';
import { formatDuration, localActivityTime } from '../ui/format.mjs';
import { activityDistance, summaryMetrics, title } from './model.mjs';
import type { Activity } from './contracts';

/** Input-only card shared by Home and the Activities feed. */
function durationLabel(row:Activity) {
  const moving = row.activity_type !== 'swim' && row.moving_time_s !== null;
  const seconds = moving ? row.moving_time_s : row.duration_s;
  return seconds===null ? null : (moving?'Moving ':'Elapsed ')+formatDuration(seconds);
}
function activityInfo(row:Activity) {
  const extras = summaryMetrics(row).filter(m => ['Pace','Avg speed','Avg HR'].includes(m.label))
    .map(m => m.label+': '+m.value).slice(0,2);
  return [row.activity_date,localActivityTime(row.start_time),activityDistance(row),durationLabel(row),...extras]
    .filter(Boolean).join(' · ');
}
export function ActivityCard({activity,onOpen}: {activity:Activity;onOpen():void}) {
  const {palette} = useSportosTheme();
  const heading = title(activity.activity_type)+(activity.subtype && !['outdoor','unknown'].includes(activity.subtype)
    ? ' · '+activity.subtype : '');
  const subtitle = activityInfo(activity);
  return <Pressable accessibilityRole="button" accessibilityLabel={heading+', '+subtitle+', source '+activity.source}
    onPress={onOpen} style={[styles.activityRow,{borderColor:palette.border}]}>
    <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
      <SportMark sport={activity.activity_type}/>
      <View style={{flex:1,gap:4}}><Text style={[styles.rowTitle,{color:palette.text}]}>{heading}</Text>
      <Text style={[styles.mini,{color:palette.muted}]}>{activity.activity_date}{localActivityTime(activity.start_time)?' · '+localActivityTime(activity.start_time):''}</Text></View>
      <Text style={{color:palette.muted,fontSize:24}} accessible={false}>›</Text>
    </View>
    {activity.distance_m !== null ? <Text style={{color:palette.text,fontSize:27,fontWeight:'700',letterSpacing:-0.8,marginTop:4,fontVariant:['tabular-nums']}}>{activityDistance(activity)}</Text> : null}
    <Text style={[styles.rowSub,{color:palette.muted}]}>{[durationLabel(activity),...summaryMetrics(activity).filter(m=>['Pace','Avg speed','Avg HR'].includes(m.label)).map(m=>m.label+': '+m.value)].filter(Boolean).join(' · ')}</Text>
    <Text style={[styles.mini,{color:palette.accent}]}>{sourceLabel(activity.source)}
      {activity.historicalSummary?' · Imported summary':''}
      {activity.distanceCorrection?' · Corrected distance':''}</Text>

  </Pressable>;
}

const styles = StyleSheet.create({
  activityRow:{borderBottomWidth:1,paddingVertical:18,minHeight:62,gap:9},
  rowTitle:{fontSize:18,fontWeight:'700'},rowSub:{fontSize:14,lineHeight:21},
  mini:{fontSize:12,lineHeight:18},
});
