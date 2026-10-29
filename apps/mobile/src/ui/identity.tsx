import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useSportosTheme } from './theme';

/** Small local vector vocabulary. No font downloads or image/network dependencies. */
export function SportGlyph({ sport = 'run', size = 24, color = 'currentColor' }: { sport?: string; size?: number; color?: string }) {
  const paths: Record<string, string> = {
    run: 'M13 7l-3 5 4 3-1 6M10 12l-4 5H2M11 9l5 3 4-1M10 8L6 9l-2 4',
    walk: 'M12 8v7l4 6M12 15l-5 6M12 9l5 4h3M12 9l-5 4-3-1',
    bike: 'M8 7h3l5 10M6 17l4-7h7l-5 7H6M16 5h3l1 3',
    swim: 'M2 18q3-3 6 0t6 0t6 0M2 22q3-3 6 0t6 0t6 0M5 14l6-6 5 3M11 8L7 4l-4 3',
    workout: 'M7 12h10M3 8v8M6 6v12M18 6v12M21 8v8',
    chart: 'M3 19h18M5 15l5-6 4 3 6-8',
    map: 'M3 5l6-2 6 3 6-2v15l-6 2-6-3-6 2V5M9 3v15M15 6v15',
    arrow: 'M5 12h14M13 6l6 6-6 6',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3M8 12l3 3 5-6',
    info: 'M12 11v6M12 7h.01',
    steps: 'M7 3c-3 0-3 7 0 7s3-7 0-7M17 9c-3 0-3 7 0 7s3-7 0-7M5 14h4M15 20h4',
  };
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    <Path d={paths[sport] ?? paths.chart} stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    {['run','walk'].includes(sport) ? <Circle cx="14" cy="4" r="2" fill={color} /> : null}
    {sport === 'bike' ? <><Circle cx="6" cy="17" r="4" stroke={color} strokeWidth="1.6" fill="none" /><Circle cx="19" cy="17" r="4" stroke={color} strokeWidth="1.6" fill="none" /></> : null}
    {sport === 'swim' ? <Circle cx="18" cy="11" r="2" fill={color} /> : null}
    {sport === 'info' ? <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.7" fill="none" /> : null}
  </Svg>;
}

export function SportMark({ sport, size = 46 }: { sport: string; size?: number }) {
  const { dark } = useSportosTheme();
  const colors: Record<string, [string,string]> = {
    run: ['#F7E5D9','#A64C22'], bike: ['#E8E6F7','#6550A0'], swim: ['#DFEDF7','#266D97'],
    workout: ['#F5E3E9','#A33F65'], walk: ['#E6EDDC','#557437'],
  };
  const [background, ink] = colors[sport] ?? ['#E7EDE3','#3D6848'];
  return <View style={{ width:size,height:size,borderRadius:16,backgroundColor:dark?'#303C32':background,alignItems:'center',justifyContent:'center' }}>
    <SportGlyph sport={sport} color={dark ? background : ink} size={24}/>
  </View>;
}

/** Decorative track lines, never a score gauge or a fabricated activity chart. */
export function TrackArt() {
  return <View pointerEvents="none" accessible={false} accessibilityElementsHidden style={styles.art}>
    <Svg width="210" height="280" viewBox="0 0 210 280">
      {[0,1,2,3,4].map(i=><Rect key={i} x={12+i*17} y={12+i*17} width={230-i*34} height={260-i*34} rx={115-i*17}
        fill="none" stroke="#D5F477" strokeOpacity={0.13} strokeWidth="1.2" transform="rotate(24 120 140)"/>)}
    </Svg>
  </View>;
}
export function BrandBanner() {
  const { palette } = useSportosTheme();
  return <View style={[styles.banner,{backgroundColor:palette.hero}]}>
    <TrackArt/>
    <View style={styles.brand}><SportGlyph sport="run" color={palette.lime} size={32}/><Text style={[styles.wordmark,{color:palette.heroText}]}>SportOS</Text></View>
    <Text style={[styles.tagline,{color:palette.heroText}]}>Every effort.{'\n'}One place.</Text>
    <Text style={[styles.caption,{color:palette.heroMuted}]}>Your training, in perspective.</Text>
    <View style={{flexDirection:'row',gap:20,marginTop:16}}>{['run','bike','swim','workout'].map(s=><SportGlyph key={s} sport={s} color={palette.lime}/>)}</View>
  </View>;
}
const styles=StyleSheet.create({
  art:{position:'absolute',right:-45,top:-18},
  banner:{borderRadius:28,padding:26,gap:14,overflow:'hidden'},
  brand:{flexDirection:'row',alignItems:'center',gap:8},wordmark:{fontSize:18,fontWeight:'800',letterSpacing:-0.6},
  tagline:{fontSize:39,lineHeight:43,fontWeight:'800',letterSpacing:-1.5,marginTop:18},
  caption:{fontSize:15,lineHeight:22},
});
