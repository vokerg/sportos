import { createHash } from 'node:crypto';
import { stravaSummaryRoute, type ActivityRouteResponse } from './activity-route.js';
export const ROUTE_ALGORITHM_VERSION=1;
const MAX_INPUT=150000, MAX_OUTPUT=3000;
type Point=[number,number]; // longitude,latitude
type Fix={point:Point|null; time?:number};
export type ProjectedRoute={
 provider:'strava'|'garmin';resolution:'streams'|'detail'|'fit';polylines:string[];
 bounds:[number,number,number,number];pointCount:number;resourceHash:string;
};
function obj(v:unknown):Record<string,unknown>|null {
 return v && typeof v==='object' && !Array.isArray(v) ? v as Record<string,unknown> : null;
}
function coord(lat:unknown,lon:unknown):Point|null {
 return typeof lat==='number'&&typeof lon==='number'&&Number.isFinite(lat)&&Number.isFinite(lon)
  &&Math.abs(lat)<=90&&Math.abs(lon)<=180?[lon,lat]:null;
}
function distance(a:Point,b:Point) {
 return Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*Math.PI/360),a[1]-b[1])*111195;
}
/** All polyline encoding is precision 1e5 and latitude first (GeoJSON is reversed). */
export function encodeRoutePolyline(points:Point[]):string {
 let lat=0,lon=0,result='';
 const append=(delta:number)=>{
  let n=delta<0?-delta*2-1:delta*2;
  while(n>=32){result+=String.fromCharCode(n%32+95);n=Math.floor(n/32);}
  result+=String.fromCharCode(n+63);
 };
 for(const [x,y] of points) {
  const ny=Math.round(y*100000),nx=Math.round(x*100000);
  append(ny-lat);append(nx-lon);lat=ny;lon=nx;
 }
 return result;
}
export function decodeRichPolyline(value:unknown):Point[]|null {
 if(typeof value!=='string'||value.length<4||value.length>500000)return null;
 const result:Point[]=[];let lat=0,lon=0,i=0;
 const delta=():number|null=>{
  let n=0,shift=0;
  for(let j=0;j<7;j++){
   if(i>=value.length)return null;
   const c=value.charCodeAt(i++)-63;
   if(c<0||c>63)return null;
   n+=(c&31)*2**shift;
   if(n>0xffffffff)return null;
   if(c<32)return n%2?-(n+1)/2:n/2;
   shift+=5;
  }return null;
 };
 while(i<value.length){
  if(result.length>=MAX_INPUT)return null;
  const a=delta(),b=delta();
  if(a===null||b===null)return null;
  lat+=a;lon+=b;
  const point=coord(lat/100000,lon/100000);
  if(!point)return null;
  result.push(point);
 }return result.length>1?result:null;
}
/** Refuse any rich Strava GPS unless the compact route is valid. Clip the
 * richer prefix/suffix to the privacy-trimmed summary endpoints. */
function trim(fixes:Fix[],summary:ActivityRouteResponse):Fix[]|null {
 if(summary.status!=='available')return null;
 const line=summary.geometry.coordinates;
 const first=line[0]!,last=line[line.length-1]!;
 const start=fixes.findIndex(f=>f.point!==null&&distance(f.point,first)<=120);
 let end=-1;
 for(let i=fixes.length-1;i>start;i--)if(fixes[i]!.point!==null&&distance(fixes[i]!.point!,last)<=120){end=i;break;}
 return start<0||end<=start?null:fixes.slice(start,end+1);
}
function build(provider:ProjectedRoute['provider'],resolution:ProjectedRoute['resolution'],fixes:Fix[],source:unknown):ProjectedRoute|null {
 if(fixes.length<2||fixes.length>MAX_INPUT)return null;
 const segments:Point[][]=[];let segment:Point[]=[],previous:Fix|null=null;
 const flush=()=>{if(segment.length>1)segments.push(segment);segment=[];};
 for(const fix of fixes){
  if(!fix.point){flush();previous=null;continue;}
  if(previous?.point){
   const d=distance(previous.point,fix.point);
   const seconds=fix.time!==undefined&&previous.time!==undefined?fix.time-previous.time:null;
   if(d>3000||(seconds!==null&&(seconds<=0||seconds>300||d/seconds>70)))flush();
  }
  segment.push(fix.point);previous=fix;
 }flush();
 if(!segments.length||segments.length>50)return null;
 const count=segments.reduce((sum,s)=>sum+s.length,0);
 const step=Math.max(1,Math.ceil(count/(MAX_OUTPUT-2*segments.length)));
 const trimmed=segments.map(s=>s.filter((_,i)=>i===0||i===s.length-1||i%step===0));
 const points=trimmed.flat();
 if(points.length>MAX_OUTPUT||points.length<2)return null;
 const bounds:[number,number,number,number]=[
  Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),
  Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 if(bounds[0]===bounds[2]&&bounds[1]===bounds[3])return null;
 const polylines=trimmed.map(encodeRoutePolyline);
 if(polylines.some(s=>s.length>30000)||JSON.stringify(polylines).length>59000)return null;
 return {provider,resolution,polylines,bounds,pointCount:points.length,
  resourceHash:createHash('sha256').update(JSON.stringify(source)).digest('hex')};
}
export function projectStravaRoute(streams:unknown,detail:unknown,summary:ActivityRouteResponse):ProjectedRoute|null {
 if(summary.status!=='available')return null;
 const data=obj(obj(streams)?.latlng)?.data;
 if(Array.isArray(data)&&data.length>=2&&data.length<=MAX_INPUT){
  const times=obj(obj(streams)?.time)?.data;
  const fixes:Fix[]=data.map((v,i)=>({
   point:Array.isArray(v)&&v.length===2?coord(v[0],v[1]):null,
   time:Array.isArray(times)&&typeof times[i]==='number'&&Number.isFinite(times[i])?times[i]:undefined}));
  const cropped=trim(fixes,summary);
  const route=cropped&&build('strava','streams',cropped,data);
  if(route)return route;
 }
 const polyline=obj(obj(detail)?.map)?.polyline;
 const decoded=decodeRichPolyline(polyline);
 if(decoded){
  const cropped=trim(decoded.map(point=>({point})),summary);
  const route=cropped&&build('strava','detail',cropped,polyline);
  if(route)return route;
 }
 return null;
}
/** tools/garmin/extract_activity.py uses fitdecode default: position coordinates
 * remain in semicircles. StandardUnitsDataProcessor would label degrees.
 * Never convert a degrees value twice or guess undocumented units. */
function fitNumber(field:unknown):number|null{
 const x=obj(field),v=x?.value;
 if(typeof v!=='number'||!Number.isFinite(v))return null;
 return x?.units==='semicircles'?v*180/2**31:x?.units==='deg'||x?.units==='degrees'?v:null;
}
export function projectGarminRoute(messages:unknown):ProjectedRoute|null{
 if(!Array.isArray(messages)||messages.length<2||messages.length>MAX_INPUT)return null;
 const fixes:Fix[]=[];
 for(const m of messages){
  const message=obj(m);
  if(message?.message!=='record'||!Array.isArray(message.fields))continue;
  const field=(name:string)=>message.fields.find(x=>obj(x)?.name===name);
  const rawTime=obj(field('timestamp'))?.value;
  const time=typeof rawTime==='string'?Date.parse(rawTime)/1000:undefined;
  fixes.push({point:coord(fitNumber(field('position_lat')),fitNumber(field('position_long'))),
   time:typeof time==='number'&&Number.isFinite(time)?time:undefined});
 }
 return build('garmin','fit',fixes,messages);
}
export function decodeStoredRoute(row:{provider:'strava'|'garmin';resolution:'streams'|'detail'|'fit';
 polylines:unknown;bounds:unknown;point_count:number}):ActivityRouteResponse|null{
 if(!Array.isArray(row.polylines)||row.polylines.length<1||row.polylines.length>50
  ||!Array.isArray(row.bounds)||row.bounds.length!==4||row.bounds.some(x=>typeof x!=='number'||!Number.isFinite(x))
  ||row.point_count<2||row.point_count>MAX_OUTPUT)return null;
 const segments:Point[][]=[];
 for(const encoded of row.polylines){
  const decoded=stravaSummaryRoute(encoded,typeof encoded==='string'?'string':'object');
  if(decoded.status!=='available')return null;
  segments.push(decoded.geometry.coordinates);
 }
 const points=segments.flat();
 if(points.length!==row.point_count)return null;
 const bounds:[number,number,number,number]=[
  Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),
  Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
 if(row.bounds.some((x,i)=>Math.abs(x-bounds[i]!)>0.00002))return null;
 return {status:'available',source:row.provider,resolution:row.resolution,
  geometry:segments.length===1?{type:'LineString',coordinates:segments[0]!}:{type:'MultiLineString',coordinates:segments},
  bounds,pointCount:points.length};
}
