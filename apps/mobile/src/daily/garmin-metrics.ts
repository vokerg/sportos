export interface DayMetric {key:string;label:string;value:number;unit:string}
type RecordValue=Record<string,unknown>;
const fields:Record<string,Array<[string,string,string]>>={
 summary:[['steps','Steps',''],['distanceM','Distance','km'],['activeCalories','Active energy','kcal'],['totalCalories','Total energy','kcal'],['floorsClimbed','Floors climbed',''],['moderateIntensityMinutes','Moderate activity','min'],['vigorousIntensityMinutes','Vigorous activity','min']],
 sleep:[['sleepSeconds','Sleep','duration'],['deepSleepSeconds','Deep sleep','duration'],['remSleepSeconds','REM sleep','duration'],['lightSleepSeconds','Light sleep','duration'],['awakeSeconds','Awake','duration']],
 heart_rate:[['restingBpm','Resting heart rate','bpm'],['minBpm','Lowest heart rate','bpm'],['maxBpm','Peak heart rate','bpm']],
 hrv:[['lastNightAvgMs','Overnight HRV','ms'],['weeklyAvgMs','Weekly HRV','ms']],
 stress:[['averageLevel','Average stress',''],['maxLevel','Peak stress','']],
 body_battery:[['charged','Body Battery gained',''],['drained','Body Battery used','']],
 activities:[['count','Sessions','']],
};
function number(value:unknown):number|null{
 if(value===null||value===undefined)return null;
 if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>10000000)throw new Error('Invalid Garmin metric');
 return value;
}
export function metricEntries(category:string,evidence:unknown):DayMetric[]{
 if(evidence===null||evidence===undefined)return [];
 if(typeof evidence!=='object'||Array.isArray(evidence))throw new Error('Invalid Garmin metrics');
 const data=evidence as RecordValue;
 if(category==='weight'){
  if(data.measurements===undefined)return [];
  if(!Array.isArray(data.measurements)||data.measurements.length>100)throw new Error('Invalid measurements');
  const rows=data.measurements.map((r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Invalid measurement');const row=r as RecordValue;return{row,index:i,time:typeof row.recordedAt==='string'&&Number.isFinite(Date.parse(row.recordedAt))?Date.parse(row.recordedAt):null}});
  // Keep measurements without timestamps in source order; don't claim a latest value.
  const dated=rows.filter(r=>r.time!==null).sort((a,b)=>b.time!-a.time!);
  const selected=dated[0]??(rows.length===1?rows[0]:null);
  if(!selected)return [];
  return ([['weightKg','Weight','kg'],['bodyFatPct','Body fat','%'],['muscleMassKg','Muscle mass','kg'],['bodyWaterPct','Body water','%']] as const).flatMap(([key,label,unit])=>{
   const value=number(selected.row[key]);return value===null?[]:[{key:category+'.'+key,label,value,unit}];
  });
 }
 return (fields[category]??[]).flatMap(([key,label,unit])=>{const value=number(data[key]);return value===null?[]:[{key:category+'.'+key,label,value,unit}]});
}
export function formatDayMetric(metric:DayMetric):string{
 if(metric.unit==='duration'){const minutes=Math.round(metric.value/60);return `${Math.floor(minutes/60)}h ${minutes%60}m`}
 const value=metric.key==='summary.distanceM'?metric.value/1000:metric.value;
 const formatted=value.toLocaleString('en-US',{maximumFractionDigits:metric.unit==='kg'?1:metric.unit==='km'?2:metric.unit==='%'?1:0});
 return formatted+(metric.unit?' '+metric.unit:'');
}
