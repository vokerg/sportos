import React from 'react';
import Svg,{Circle,Path,Rect} from 'react-native-svg';
/** Code-native symbols keep every tab legible without fonts or emoji fallback. */
export function TabIcon({name,color}:{name:string;color:string}){
 return <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" accessible={false}>
  {name==='Home'?<><Path d="M3 10 12 3l9 7"/><Path d="M5 9v12h14V9M9 21v-7h6v7"/></>:null}
  {name==='Daily'?<><Rect x={3} y={5} width={18} height={16} rx={3}/><Path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/></>:null}
  {name==='Activities'?<><Path d="M2 13h4l3-8 5 15 3-9h5"/></>:null}
  {name==='RunLab'?<><Path d="M4 20V4M4 20h16M8 15l4-5 3 2 5-7"/><Path d="M16 5h4v4"/></>:null}
  {name==='More'?<>{[5,12,19].map(cx=><Circle key={cx} cx={cx} cy={12} r={1.6} fill={color} stroke="none"/>)}</>:null}
 </Svg>;
}
