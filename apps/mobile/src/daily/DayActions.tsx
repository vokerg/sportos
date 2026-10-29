import React from 'react';
import {TextInput,Switch,View,Text} from 'react-native';
import {Action,Body,Card} from '../ui/primitives';
import {useSportosTheme} from '../ui/theme';
import {factFields,useDayActions} from './day-actions';
import type {useGarminDay} from './GarminDayCard';

export function DayActions({actions:a,garmin:g,ready}:{actions:ReturnType<typeof useDayActions>;garmin:ReturnType<typeof useGarminDay>;ready:boolean}){
 const {palette}=useSportosTheme();const disabled=a.busy||g.busy||!ready||!!a.editor;
 return <Card title="Day actions">
  <Action title={a.pending||a.uncertain?'Check refresh status':'Refetch day from Strava'} disabled={disabled||a.connection?.status!=='connected'} onPress={a.refreshStrava}/>
  <Action title="Refresh from Garmin" disabled={disabled||!g.data?.fetchEnabled} onPress={g.refresh}/>
  <Action title="Recalculate from activities" disabled={disabled||!!a.pending||a.uncertain} onPress={a.recalculate}/>
  <Action title="Enter facts manually" disabled={disabled||!!a.pending||a.uncertain} onPress={a.openEditor}/>
  <Body subdued>Strava refetch updates activities, then recalculates this day. Garmin refresh updates evidence; use Recalculate to update totals and score.</Body>
  {a.connectionLoaded&&a.connection?.status!=='connected'?<Body subdued>Connect or reauthorize Strava on the website to enable refetch.</Body>:null}
  {!a.connectionLoaded&&!a.busy?<Action title="Check Strava connection" secondary onPress={a.loadConnection}/>:null}
  {g.data&&!g.data.fetchEnabled?<Body subdued>Garmin refresh is unavailable on this server. Saved Garmin measurements remain available.</Body>:null}
  {a.busy?<Body subdued>Working…</Body>:null}{a.message?<Body>{a.message}</Body>:null}
  {a.error?<Body>{a.error}</Body>:null}{g.error?<Body>{g.error}</Body>:null}
  {a.editor?<>
   <Body>Replace the daily facts below. Saving recalculates the score on the server and replaces prior manual activities. Distances from other sources are preserved.</Body>
   {factFields.map(([key,label])=><View key={key} style={{gap:6}}>
    <Text style={{color:palette.text}}>{key==='steps'&&a.editor?.totalSteps?'All-day steps':label}</Text>
    <TextInput accessibilityLabel={key==='steps'&&a.editor?.totalSteps?'All-day steps':label} value={a.editor!.draft[key]}
     editable={!a.busy} keyboardType="decimal-pad" maxLength={18}
     style={{color:palette.text,backgroundColor:palette.soft,borderRadius:10,padding:12,minHeight:48}}
     onChangeText={value=>a.setEditor(current=>current?{...current,draft:{...current.draft,[key]:value}}:null)}/>
   </View>)}
   <View style={{gap:8}}><Body>My step count includes running; subtract estimated run steps on save</Body>
    <Switch accessibilityLabel="Steps include running" value={a.editor.totalSteps} disabled={a.busy} onValueChange={value=>a.setEditor(current=>current?{...current,totalSteps:value}:null)}/>
   </View>
   <Body subdued>Zero steps or workout points allow retained provider evidence to resolve those values. Recalculate replaces a manual bonus with rule-derived bonuses.</Body>
   {a.validation?<Body>{a.validation}</Body>:null}
   <Action title={a.busy?'Saving…':'Save manual facts'} disabled={a.busy} onPress={a.save}/>
   <Action title="Cancel manual entry" secondary disabled={a.busy} onPress={()=>a.setEditor(null)}/>
  </>:null}
 </Card>;
}
