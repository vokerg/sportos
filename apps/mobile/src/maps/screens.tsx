import React, {useCallback, useMemo, useState, useRef} from 'react';
import {StyleSheet, View, Text} from 'react-native';
import {useFocusEffect, useIsFocused} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {Map as NativeMap, Camera, GeoJSONSource, Layer, LogManager, type StyleSpecification} from '@maplibre/maplibre-react-native';
import {useSession} from '../auth/SessionProvider';
import {Action, Body, Card, Screen, StatusPanel} from '../ui/primitives';
import {useSportosTheme} from '../ui/theme';
import {localToday, shiftCalendarDate} from '../ui/format.mjs';
import type {RootStack} from '../navigation/routes';
import {mapData, projectHeatmap, projectRoute, type MapRoute} from './model.mjs';
// Native messages can contain tile URLs/viewports. Do not forward them to telemetry/logs.
LogManager.onLog(() => true);
const style:StyleSpecification={version:8,sources:{osm:{type:'raster',tiles:['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors'}},layers:[{id:'osm',type:'raster',source:'osm',paint:{'raster-saturation':-.35}}]};

function RouteCanvas({routes,heatmap}:{routes:MapRoute[];heatmap:boolean}) {
  const data=useMemo(()=>mapData(routes),[routes]);
  const [failed,setFailed]=useState(false);
  const {palette}=useSportosTheme();
  if(!data.points) return null;
  return <View style={{flex:1,minHeight:300}}>
    <NativeMap style={StyleSheet.absoluteFill} mapStyle={style} attribution logo={false}
      onDidFailLoadingMap={()=>setFailed(true)} accessibilityLabel={heatmap?'Private retained route density map':'Recorded activity route map'}>
      <Camera key={routes.length} initialViewState={{bounds:[...data.bounds[0],...data.bounds[1]],padding:{top:40,bottom:60,left:35,right:35}}}/>
      {heatmap?<GeoJSONSource id="density" data={data.density}>
        <Layer id="density-halo" type="heatmap" paint={{
          'heatmap-weight':['interpolate',['linear'],['get','weight'],1,.15,10,1],
          'heatmap-radius':18,'heatmap-intensity':1.2,'heatmap-opacity':.8,
          'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(64,0,176,0)',.3,'#a78bfa',.65,'#7c3aed',1,'#3b0764']}}/>
      </GeoJSONSource>:null}
      <GeoJSONSource id="routes" data={data.lines}>
        <Layer id="route-lines" type="line" paint={{'line-color':heatmap?'#6d28d9':'#087e8b','line-width':heatmap?1.5:4,'line-opacity':heatmap?.45:1}}/>
      </GeoJSONSource>
      {!heatmap?<GeoJSONSource id="ends" data={{type:'FeatureCollection',features:[
        {type:'Feature',properties:{end:false},geometry:{type:'Point',coordinates:data.start}},
        {type:'Feature',properties:{end:true},geometry:{type:'Point',coordinates:data.finish}}]}}>
        <Layer id="end-markers" type="circle" paint={{'circle-radius':7,'circle-color':['case',['get','end'],'#be123c','#15803d'],'circle-stroke-color':'#fff','circle-stroke-width':2}}/>
      </GeoJSONSource>:null}
    </NativeMap>
    {failed?<View style={{backgroundColor:palette.surface,padding:12}}><Body>Base map unavailable. Check your connection and reopen. Retained routes do not require a provider download.</Body></View>:null}
    <Text style={{position:'absolute',bottom:8,left:8,backgroundColor:palette.surface,color:palette.text,padding:5,fontSize:12}}>
      {heatmap?'Darker = more routes · ~0.001° cells':'Green start · red finish'}
    </Text>
  </View>;
}

export function MapScreen({route}:NativeStackScreenProps<RootStack,'RouteMap'>) {
  const focused=useIsFocused();
  const {read}=useSession(); const {palette}=useSportosTheme();
  const [routes,setRoutes]=useState<MapRoute[]>([]);
  const [message,setMessage]=useState<string|null>(null);const [busy,setBusy]=useState(true);
  const [revision,setRevision]=useState(0);
  useFocusEffect(useCallback(()=>{
    let active=true;setRoutes([]);setBusy(true);setMessage(null);
    void read<unknown>(`/activities/${encodeURIComponent(route.params.activityId)}/route`).then(raw=>{
      const result=projectRoute(raw);
      if(!active)return;
      if(result.status==='available')setRoutes([result]);
      else setMessage(result.reason==='indoor_pool_swim'?'Indoor pool workout has no GPS route.':'No usable GPS route is retained for this activity.');
    }).catch(()=>{if(active)setMessage('Could not read the route. Check your connection or retry.');}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[read,route.params.activityId,revision]));
  return <View style={{flex:1,backgroundColor:palette.background}}>
    <View style={{padding:16,gap:8}}>
      {routes[0]?<Body>{routes[0].source} · {routes[0].resolution} geometry · recording gaps preserved</Body>:null}
      {busy?<StatusPanel kind="loading" message="Reading retained route…"/>:null}
      {message?<StatusPanel kind="empty" message={message} retry={()=>setRevision(n=>n+1)}/>:null}
    </View>
    {focused&&routes.length?<RouteCanvas routes={routes} heatmap={false}/>:null}
  </View>;
}

export function HeatmapScreen() {
  const focused=useIsFocused();
  const {read}=useSession();const {palette}=useSportosTheme();
  const retained=useRef<MapRoute[]>([]);
  const [days,setDays]=useState(30);const [sport,setSport]=useState('all');const [revision,setRevision]=useState(0);
  const [routes,setRoutes]=useState<MapRoute[]>([]);const [message,setMessage]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);const [coverage,setCoverage]=useState<Record<string,number>>({});
  const [next,setNext]=useState<string|null>(null); const [page,setPage]=useState(0);
  const [cursors,setCursors]=useState<(string|null)[]>([null]);
  useFocusEffect(useCallback(()=>{
    let active=true;setBusy(true);setMessage(null);
    if(page===0){retained.current=[];setRoutes([]);setCoverage({});setNext(null);}
    const query=new URLSearchParams({from:shiftCalendarDate(localToday(),1-days),to:localToday(),limit:'25'});
    if(sport!=='all')query.set('activityType',sport);
    if(cursors[page])query.set('cursor',cursors[page]!);
    void read<unknown>('/heatmap/routes?'+query).then(raw=>{
      const result=projectHeatmap(raw);if(!active)return;
      const all=page===0?result.items:[...retained.current,...result.items];
      mapData(all);retained.current=all;setRoutes(all);
      setCoverage(old=>Object.fromEntries(Object.keys(result.coverage).map(k=>[k,(page===0?0:old[k]??0)+result.coverage[k]])));
      setNext(result.nextCursor);
      if(!result.items.length)setMessage('No additional GPS geometry in this page. Coverage includes missing and invalid routes.');
    }).catch(()=>{if(active)setMessage('Could not read this map page. Check your connection or narrow the range.');}).finally(()=>{if(active)setBusy(false);});
    return ()=>{active=false;};
  },[read,days,sport,revision,page,cursors]));
  const reset=()=>{setPage(0);setCursors([null]);setRevision(n=>n+1);};
  return <View style={{flex:1,backgroundColor:palette.background}}>
    <View style={{padding:12,gap:8}}>
      <View style={{flexDirection:'row',gap:8}}>{[30,90,365].map(n=><View key={n} style={{flex:1}}><Action title={n+' days'} secondary={days!==n} onPress={()=>{setDays(n);reset();}}/></View>)}</View>
      <View style={{flexDirection:'row',gap:8}}>{['all','run','bike','walk'].map(s=><View key={s} style={{flex:1}}><Action title={s} secondary={sport!==s} onPress={()=>{setSport(s);reset();}}/></View>)}</View>
      <Body subdued>{routes.length} routes · {coverage.eligibleScanned??0} scanned · {coverage.missingGps??0} missing GPS · {(coverage.invalidGeometry??0)+(coverage.budgetExceeded??0)} omitted</Body>
      <Body subdued>Summary/streams/detail/FIT precision varies. Density represents retained route presence, not distance or effort. Up to 50 routes per view.</Body>
      {message?<Body>{message}</Body>:null}
      {busy?<Body>Reading retained routes…</Body>:<View style={{flexDirection:'row',gap:8}}>
        <View style={{flex:1}}><Action title="Reload" secondary onPress={reset}/></View>
        {next&&page<1?<View style={{flex:1}}><Action title="Load next page" onPress={()=>{setCursors(c=>[...c,next]);setPage(p=>p+1);}}/></View>:null}
      </View>}
    </View>
    {focused&&routes.length?<RouteCanvas routes={routes} heatmap/>:!busy?<View style={{padding:16}}><Body>No retained routes in this selection. Choose another range or sport.</Body></View>:null}
  </View>;
}
